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

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import sqlite3

from api.catalog import CatalogResponse
from api.storage import connect_database, list_active_activities

CATALOG = json.loads((Path(__file__).resolve().parents[1] / 'src/data/catalog.json').read_text())
ACTIVITIES = {item['id']: item for item in CATALOG['activities']}
MOODS = {item['id']: item for item in CATALOG['moods']}


class Notification(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    activity_id: str = Field(max_length=32)
    mood: Literal['surprise', 'calm', 'outdoor']
    invitation_title: str = Field(default='', max_length=52)
    consent: Literal[True]
    submission_id: str = Field(pattern=r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')

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

    @model_validator(mode='after')
    def allowed_activity(self):
        if self.activity_id not in MOODS[self.mood]['activities']:
            raise ValueError('Activity is not in the selected mood')
        return self


def create_app(token=None, chat_id=None, transport=None, clock=time.monotonic, database_path=None):
    token = os.getenv('TELEGRAM_BOT_TOKEN', '') if token is None else token
    chat_id = os.getenv('TELEGRAM_CHAT_ID', '') if chat_id is None else chat_id
    configured = bool(token.strip() and chat_id.strip())
    # Bounded global token bucket: no visitor identifiers or IPs are retained.
    budget, updated = 12.0, clock()
    submissions = {}  # id -> (expiry, payload, state); max 512; one API worker only
    slots = asyncio.Semaphore(2)

    @asynccontextmanager
    async def lifespan(app):
        path = Path(database_path if database_path is not None else os.getenv('DATABASE_PATH', 'data/date-wheel.sqlite3'))
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        database = connect_database(path)
        app.state.database = database
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(7.0), transport=transport, trust_env=False) as client:
                app.state.telegram = client
                yield
        finally:
            database.close()
            app.state.database = None

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        return JSONResponse({'detail': 'Invalid notification request.'}, status_code=422)

    @app.middleware('http')
    async def limits(request: Request, call_next):
        nonlocal budget, updated
        if request.url.path == '/api/notify':
            now = clock()
            budget = min(12.0, budget + max(0, now - updated) / 5)
            updated = now
            if budget < 1:
                return JSONResponse({'detail': 'Please try again later.'}, status_code=429, headers={'Retry-After': '5'})
            budget -= 1
            # Bound streamed bodies as well as Content-Length; no request body logs.
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > 2048:
                    return JSONResponse({'detail': 'Request too large.'}, status_code=413)
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
        except sqlite3.Error:
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
        if not configured:
            raise HTTPException(503, 'Notifications are unavailable.')
        now = clock()
        for key in [key for key, record in submissions.items() if record[0] <= now]:
            del submissions[key]
        payload = (data.activity_id, data.mood, data.invitation_title)
        previous = submissions.get(data.submission_id)
        if previous:
            if previous[1] != payload:
                raise HTTPException(409, 'Submission conflicts with an earlier request.')
            if previous[2] == 'sent':
                return {'accepted': True}
            raise HTTPException(409, 'Submission is already being processed.')
        if len(submissions) >= 512 or slots.locked():
            raise HTTPException(429, 'Please try again later.')
        submissions[data.submission_id] = (now + 600, payload, 'pending')
        activity = ACTIVITIES[data.activity_id]
        title = data.invitation_title or 'یه قرارِ کوچولو'
        message = (f'🎡 یه نفر گردونه رو چرخوند!\n\n💌 دعوت‌نامه: {title}\n'
                   f'🎯 نتیجه: {activity["title"]}\n🌷 حال‌وهوا: {MOODS[data.mood]["label"]}\n\n'
                   f'✨ پیشنهاد کوچولو:\n{activity["suggestion"]}\n\n(نتیجهٔ اعلام‌شده توسط فرستنده)')
        try:
            async with slots, asyncio.timeout(8):
                response = await app.state.telegram.post(
                    f'https://api.telegram.org/bot{token}/sendMessage',
                    json={'chat_id': chat_id, 'text': message, 'link_preview_options': {'is_disabled': True}})
                result = response.json()
                if response.status_code != 200 or result.get('ok') is not True or not isinstance(result.get('result', {}).get('message_id'), int):
                    raise ValueError('Telegram did not accept the message')
        except (httpx.HTTPError, TimeoutError, ValueError, TypeError, AttributeError):
            submissions.pop(data.submission_id, None)
            raise HTTPException(502, 'Delivery could not be confirmed. Please try again.') from None
        submissions[data.submission_id] = (clock() + 600, payload, 'sent')
        return {'accepted': True}

    return app


app = create_app()
