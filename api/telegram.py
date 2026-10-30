"""Shared Telegram Bot API calls and safe, persistent diagnostics."""
import asyncio
from datetime import datetime, timezone
import sqlite3

import httpx


class TelegramFailure(Exception):
    def __init__(self, summary: str):
        super().__init__(summary)
        self.summary = summary


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _safe_failure(status: int | None, body: dict | None) -> str:
    description = body.get('description', '').lower() if isinstance(body, dict) else ''
    if status in (401, 404) or 'unauthorized' in description:
        return 'توکن ربات توسط تلگرام پذیرفته نشد.'
    if status == 429:
        return 'تلگرام موقتاً درخواست‌ها را محدود کرده؛ کمی بعد دوباره تلاش کنید.'
    if status == 403 or 'bot was blocked' in description or "can't initiate conversation" in description or 'bot can\'t initiate' in description:
        return 'تلگرام اجازهٔ ارسال به مقصد را نداد؛ ربات را در گفت‌وگوی مقصد فعال کنید.'
    if status == 400 and 'chat not found' in description:
        return 'گفت‌وگوی مقصد پیدا نشد؛ ابتدا در گفت‌وگوی خصوصی ربات /start را بفرستید و شناسهٔ مقصد را بررسی کنید.'
    if status is not None and status >= 500:
        return 'سرویس تلگرام موقتاً در دسترس نیست.'
    if status == 400:
        return 'تلگرام درخواست را نپذیرفت؛ شناسهٔ مقصد و دسترسی ربات را بررسی کنید.'
    return 'پاسخ تلگرام قابل تأیید نبود؛ وضعیت ارسال نامشخص است.'


async def api_call(client: httpx.AsyncClient, token: str, method: str, payload: dict | None = None) -> dict:
    """Call a fixed Bot API method; never return raw error details or URLs."""
    try:
        async with asyncio.timeout(8):
            response = await client.post(f'https://api.telegram.org/bot{token}/{method}', json=payload or {})
    except (httpx.TimeoutException, TimeoutError):
        raise TelegramFailure('پاسخ تلگرام در مهلت مقرر نرسید؛ پذیرش پیام قابل تأیید نیست.') from None
    except httpx.HTTPError:
        raise TelegramFailure('اتصال به تلگرام برقرار نشد؛ شبکه یا DNS سرور را بررسی کنید.') from None
    try:
        body = response.json()
    except (ValueError, TypeError):
        body = None
    if response.status_code != 200 or not isinstance(body, dict) or body.get('ok') is not True:
        raise TelegramFailure(_safe_failure(response.status_code, body if isinstance(body, dict) else None))
    result = body.get('result')
    if not isinstance(result, dict):
        raise TelegramFailure('پاسخ تلگرام قابل تأیید نبود؛ وضعیت ارسال نامشخص است.')
    return result


async def send_message(client: httpx.AsyncClient, token: str, chat_id: str, text: str) -> int:
    result = await api_call(client, token, 'sendMessage', {
        'chat_id': chat_id,
        'text': text,
        'link_preview_options': {'is_disabled': True},
    })
    message_id = result.get('message_id')
    if isinstance(message_id, bool) or not isinstance(message_id, int):
        raise TelegramFailure('پاسخ تلگرام قابل تأیید نبود؛ پذیرش پیام تأیید نشد.')
    return message_id


async def validate_bot(client: httpx.AsyncClient, token: str) -> dict:
    result = await api_call(client, token, 'getMe')
    if result.get('is_bot') is not True or isinstance(result.get('id'), bool) or not isinstance(result.get('id'), int):
        raise TelegramFailure('تلگرام هویت ربات را تأیید نکرد.')
    return {'validated': True}


def record_send(database: sqlite3.Connection, accepted: bool, summary: str | None, *, is_test: bool = False, at: str | None = None):
    moment = at or now_utc()
    with database:
        if accepted:
            database.execute('''UPDATE telegram_diagnostics SET last_success_at=?, last_error=NULL,
                success_count=success_count+1, last_test_at=CASE WHEN ? THEN ? ELSE last_test_at END WHERE id=1''',
                (moment, int(is_test), moment))
        else:
            database.execute('''UPDATE telegram_diagnostics SET last_failure_at=?, last_error=?,
                failure_count=failure_count+1, last_test_at=CASE WHEN ? THEN ? ELSE last_test_at END WHERE id=1''',
                (moment, summary or 'پذیرش پیام تأیید نشد.', int(is_test), moment))


def record_validation(database: sqlite3.Connection, validated: bool, summary: str | None, *, at: str | None = None):
    with database:
        database.execute('UPDATE telegram_diagnostics SET bot_validated_at=?, validation_error=? WHERE id=1',
                         ((at or now_utc()) if validated else None, None if validated else summary))


def read_diagnostics(database: sqlite3.Connection, *, configured: bool, token_present: bool, destination_present: bool):
    row = database.execute('''SELECT last_success_at, last_failure_at, last_error, success_count,
        failure_count, last_test_at, bot_validated_at, validation_error
        FROM telegram_diagnostics WHERE id=1''').fetchone()
    if row is None:
        raise sqlite3.DatabaseError('Diagnostics record is missing')
    return {
        'api_operational': True,
        'configured': configured,
        'bot_token_configured': token_present,
        'destination_configured': destination_present,
        'bot_validation': 'valid' if row[6] else ('invalid' if row[7] else 'not_checked'),
        'bot_validated_at': row[6],
        'validation_error': row[7],
        'last_successful_acceptance': row[0],
        'last_failed_attempt': row[1],
        'last_failure_summary': row[2],
        'success_count': row[3],
        'failure_count': row[4],
        'last_test_at': row[5],
        'read_by_recipient': None,
        'delivery_semantics': 'Telegram API acceptance is confirmed; recipient reading is not observable.',
    }
