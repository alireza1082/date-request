"""Single-process, optional Telegram relay. Client-reported results are unverified."""
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import re
import time
from typing import Literal
from urllib.parse import urlsplit
import hashlib
import hmac

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import sqlite3

from api.activities import install_activity_routes
from api.auth import AdminAuth, Credentials, install_admin_auth, require_admin, require_admin_mutation
from api.catalog import CatalogResponse, validate_wheel_configuration
from api.settings import install_settings_routes
from api.history import cleanup_expired, install_history_routes
from api.telegram import TelegramFailure, now_utc, read_diagnostics, record_send, record_validation, send_message, validate_bot
from api.storage import connect_database, list_active_activities, notification_activity

CATALOG = json.loads((Path(__file__).resolve().parents[1] / 'src/data/catalog.json').read_text())
MOODS = {item['id']: item for item in CATALOG['moods']}


class Notification(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    activity_id: str = Field(max_length=32)
    mood: Literal['surprise', 'calm', 'outdoor']
    invitation_title: str = Field(default='', max_length=52)
    consent: Literal[True]
    submission_id: str = Field(pattern=r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
    history_event_id: str | None = Field(default=None, pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    history_event_key: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{43}$')

    @model_validator(mode='after')
    def history_capability_pair(self):
        if (self.history_event_id is None) != (self.history_event_key is None):
            raise ValueError('History event ID and capability must be supplied together')
        return self

    @field_validator('consent', mode='before')
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError('Explicit consent is required')
        return value

    @field_validator('invitation_title')
    @classmethod
    def safe_title(cls, value):
        # Plain text only, one line. Never Telegram HTML/Markdown.
        return re.sub(r'[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]', ' ', value).strip()



def create_app(token=None, chat_id=None, transport=None, clock=time.monotonic, database_path=None, admin_clock=time.time, history_retention_days=None):
    token = os.getenv('TELEGRAM_BOT_TOKEN', '') if token is None else token
    chat_id = os.getenv('TELEGRAM_CHAT_ID', '') if chat_id is None else chat_id
    configured = bool(token.strip() and chat_id.strip())
    try:
        retention_days = int(os.getenv('HISTORY_RETENTION_DAYS', '90')) if history_retention_days is None else history_retention_days
    except ValueError:
        raise ValueError('HISTORY_RETENTION_DAYS must be an integer between 1 and 365') from None
    if isinstance(retention_days, bool) or not isinstance(retention_days, int) or not 1 <= retention_days <= 365:
        raise ValueError('HISTORY_RETENTION_DAYS must be an integer between 1 and 365')
    # Bounded global token bucket: no visitor identifiers or IPs are retained.
    budget, updated = 12.0, clock()
    history_budget, history_updated = 30.0, clock()
    submissions = {}  # id -> (expiry, payload, state); max 512; one API worker only
    slots = asyncio.Semaphore(2)
    admin_telegram_budget, admin_telegram_updated = 3.0, clock()

    def spend_telegram_admin_budget():
        nonlocal admin_telegram_budget, admin_telegram_updated
        now = clock()
        admin_telegram_budget = min(3.0, admin_telegram_budget + max(0, now - admin_telegram_updated) / 60)
        admin_telegram_updated = now
        if admin_telegram_budget < 1:
            raise HTTPException(429, 'Please try again later.', headers={'Retry-After': '60'})
        admin_telegram_budget -= 1

    @asynccontextmanager
    async def lifespan(app):
        path = Path(database_path if database_path is not None else os.getenv('DATABASE_PATH', 'data/date-wheel.sqlite3'))
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        database = connect_database(path)
        app.state.database = database
        app.state.history_retention_days = retention_days
        cleanup_task = None
        try:
            cleanup_expired(database, retention_days)
            cleanup_task = asyncio.create_task(history_cleanup_loop(database, retention_days))
            app.state.admin_auth = AdminAuth(await asyncio.to_thread(Credentials.from_environment), admin_clock)
            async with httpx.AsyncClient(timeout=httpx.Timeout(7.0), transport=transport, trust_env=False) as client:
                app.state.telegram = client
                yield
        finally:
            if cleanup_task is not None:
                cleanup_task.cancel()
                try:
                    await cleanup_task
                except asyncio.CancelledError:
                    pass
            database.close()
            app.state.database = None

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        if _request.url.path.startswith("/api/admin/settings"):
            return JSONResponse({"detail": "Invalid settings request."}, status_code=422)
        if _request.url.path.startswith("/api/admin/activities"):
            return JSONResponse({"detail": "Invalid activity request."}, status_code=422)
        if _request.url.path.startswith("/api/admin/"):
            return JSONResponse({"detail": "Invalid authentication request."}, status_code=422)
        if _request.url.path.startswith('/api/history'):
            return JSONResponse({'detail': 'Invalid history request.'}, status_code=422)
        return JSONResponse({'detail': 'Invalid notification request.'}, status_code=422)

    @app.middleware('http')
    async def limits(request: Request, call_next):
        nonlocal budget, updated, history_budget, history_updated
        if request.url.path in ('/api/notify', '/api/history') and request.method == 'POST':
            now = clock()
            if request.url.path == '/api/notify':
                budget = min(12.0, budget + max(0, now - updated) / 5)
                updated = now
                if budget < 1:
                    return JSONResponse({'detail': 'Please try again later.'}, status_code=429, headers={'Retry-After': '5', 'Cache-Control': 'no-store'})
                budget -= 1
            else:
                history_budget = min(30.0, history_budget + max(0, now - history_updated) / 10)
                history_updated = now
                if history_budget < 1:
                    return JSONResponse({'detail': 'Please try again later.'}, status_code=429, headers={'Retry-After': '10', 'Cache-Control': 'no-store'})
                history_budget -= 1
            # Bound streamed bodies as well as Content-Length; no request body logs.
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > 2048:
                    return JSONResponse({'detail': 'Request too large.'}, status_code=413, headers={'Cache-Control': 'no-store'})
                body.extend(chunk)
            request._body = bytes(body)
            origin = request.headers.get('origin')
            if origin and origin.rstrip('/') != str(request.base_url).rstrip('/'):
                # TLS is terminated by the existing proxy, which forwards proto.
                try:
                    parsed = urlsplit(origin)
                except ValueError:
                    return JSONResponse({'detail': 'Origin not allowed.'}, status_code=403)
                if parsed.netloc != request.headers.get('host') or parsed.scheme not in ('http', 'https'):
                    return JSONResponse({'detail': 'Origin not allowed.'}, status_code=403)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/healthz')
    async def health():
        return {'status': 'ok'}

    @app.get('/api/status')
    async def status():
        return {'notifications_available': configured}

    @app.get('/api/catalog', response_model=CatalogResponse)
    async def catalog():
        try:
            activities = list_active_activities(app.state.database)
            validate_wheel_configuration(activities)
        except (sqlite3.Error, ValueError):
            raise HTTPException(503, 'Activity catalog is unavailable.') from None
        return {
            'activities': activities,
            'moods': [
                {**mood, 'activities': [item['id'] for item in activities if mood['id'] in item['moods']]}
                for mood in CATALOG['moods']
            ],
        }

    @app.post('/api/notify')
    async def notify(data: Notification):
        try:
            activity = notification_activity(app.state.database, data.activity_id, data.mood)
        except sqlite3.Error:
            raise HTTPException(503, 'Activity catalog is unavailable.') from None
        if activity is None:
            raise HTTPException(422, 'Invalid notification request.')
        if not configured:
            raise HTTPException(503, 'Notifications are unavailable.')
        now = clock()
        for key in [key for key, record in submissions.items() if record[0] <= now]:
            del submissions[key]
        payload = (data.activity_id, data.mood, data.invitation_title, data.history_event_id, data.history_event_key)
        previous = submissions.get(data.submission_id)
        if previous:
            if previous[1] != payload:
                raise HTTPException(409, 'Submission conflicts with an earlier request.')
            if previous[2] == 'sent':
                return {'accepted': True}
            raise HTTPException(409, 'Submission is already being processed.')
        if len(submissions) >= 512 or slots.locked():
            raise HTTPException(429, 'Please try again later.')
        history_link = None
        if data.history_event_id is not None:
            supplied_hash = hashlib.sha256(data.history_event_key.encode('ascii')).hexdigest()
            try:
                history_link = app.state.database.execute('''SELECT event_key_hash FROM spins
                    WHERE id=? AND activity_id=? AND mood_id=? AND invitation_title=?''',
                    (data.history_event_id, data.activity_id, data.mood, data.invitation_title)).fetchone()
            except sqlite3.Error:
                raise HTTPException(503, 'Notification is temporarily unavailable.') from None
            if not history_link or not history_link[0] or not hmac.compare_digest(history_link[0], supplied_hash):
                raise HTTPException(422, 'Invalid notification request.')
            with app.state.database:
                app.state.database.execute("UPDATE spins SET telegram_attempted=1, telegram_status='attempted' WHERE id=?", (data.history_event_id,))
        submissions[data.submission_id] = (now + 600, payload, 'pending')
        title = data.invitation_title or 'یه قرارِ کوچولو'
        message = (f'🎡 یه نفر گردونه رو چرخوند!\n\n💌 دعوت‌نامه: {title}\n'
                   f'🎯 نتیجه: {activity[0]}\n🌷 حال‌وهوا: {MOODS[data.mood]["label"]}\n\n'
                   f'✨ پیشنهاد کوچولو:\n{activity[1]}\n\n(نتیجهٔ اعلام‌شده توسط فرستنده)')
        try:
            async with slots, asyncio.timeout(8):
                await send_message(app.state.telegram, token, chat_id, message)
        except (TelegramFailure, TimeoutError) as failure:
            submissions.pop(data.submission_id, None)
            summary = failure.summary if isinstance(failure, TelegramFailure) else 'پاسخ تلگرام در مهلت مقرر نرسید؛ پذیرش پیام قابل تأیید نیست.'
            try:
                record_send(app.state.database, False, summary)
                if data.history_event_id:
                    with app.state.database:
                        app.state.database.execute("UPDATE spins SET telegram_attempted=1, telegram_succeeded=0, telegram_status='failed' WHERE id=?", (data.history_event_id,))
            except sqlite3.Error:
                pass
            raise HTTPException(502, 'Delivery could not be confirmed. Please try again.') from None
        try:
            accepted_at = now_utc()
            record_send(app.state.database, True, None, at=accepted_at)
            if data.history_event_id:
                with app.state.database:
                    app.state.database.execute("UPDATE spins SET telegram_attempted=1, telegram_succeeded=1, telegram_status='accepted', telegram_accepted_at=? WHERE id=?", (accepted_at, data.history_event_id))
        except sqlite3.Error:
            # Telegram acceptance is still true even if the diagnostic write fails.
            pass
        submissions[data.submission_id] = (clock() + 600, payload, 'sent')
        return {'accepted': True}

    @app.get('/api/admin/telegram/diagnostics')
    async def telegram_diagnostics(request: Request, _admin: str = Depends(require_admin)):
        try:
            return read_diagnostics(request.app.state.database, configured=configured,
                                    token_present=bool(token.strip()), destination_present=bool(chat_id.strip()))
        except sqlite3.Error:
            raise HTTPException(503, 'Telegram diagnostics are temporarily unavailable.') from None

    @app.post('/api/admin/telegram/validate')
    async def telegram_validate(request: Request, _admin: str = Depends(require_admin_mutation)):
        spend_telegram_admin_budget()
        if not token.strip():
            summary = 'توکن ربات تنظیم نشده است.'
            record_validation(request.app.state.database, False, summary)
            return {'validated': False, 'error_summary': summary}
        if slots.locked():
            raise HTTPException(429, 'Please try again later.')
        try:
            async with slots:
                result = await validate_bot(request.app.state.telegram, token)
            record_validation(request.app.state.database, True, None)
            return result
        except TelegramFailure as error:
            record_validation(request.app.state.database, False, error.summary)
            return {'validated': False, 'error_summary': error.summary}
        except sqlite3.Error:
            raise HTTPException(503, 'Telegram diagnostics are temporarily unavailable.') from None

    @app.post('/api/admin/telegram/test')
    async def telegram_test(request: Request, _admin: str = Depends(require_admin_mutation)):
        spend_telegram_admin_budget()
        if not token.strip() or not chat_id.strip():
            summary = 'توکن ربات یا مقصد تلگرام تنظیم نشده است.'
            try:
                with request.app.state.database:
                    request.app.state.database.execute('UPDATE telegram_diagnostics SET last_test_at=?, last_error=? WHERE id=1', (now_utc(), summary))
            except sqlite3.Error:
                raise HTTPException(503, 'Telegram diagnostics are temporarily unavailable.') from None
            return {'accepted': False, 'error_summary': summary}
        if slots.locked():
            raise HTTPException(429, 'Please try again later.')
        message = '✅ تست اتصال Date Wheel موفق بود.\nاین پیام از پنل مدیریت ارسال شده است.'
        try:
            async with slots:
                await send_message(request.app.state.telegram, token, chat_id, message)
            record_send(request.app.state.database, True, None, is_test=True)
            return {'accepted': True, 'read_by_recipient': None}
        except TelegramFailure as error:
            try:
                record_send(request.app.state.database, False, error.summary, is_test=True)
            except sqlite3.Error:
                raise HTTPException(503, 'Telegram diagnostics are temporarily unavailable.') from None
            return {'accepted': False, 'error_summary': error.summary}
        except sqlite3.Error:
            raise HTTPException(503, 'Telegram diagnostics are temporarily unavailable.') from None

    install_settings_routes(app)
    install_history_routes(app)
    install_activity_routes(app)
    install_admin_auth(app)
    return app


app = create_app()


async def history_cleanup_loop(database, retention_days):
    """Delete at most 500 expired rows hourly; continue in bounded batches."""
    while True:
        await asyncio.sleep(3600)
        try:
            cleanup_expired(database, retention_days)
        except sqlite3.Error:
            # A later scheduled sweep can retry; history submission remains usable.
            continue
