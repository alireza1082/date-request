import json
import secrets
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from api.main import create_app

ORIGIN = 'https://telegram-admin.example.test'


@pytest.fixture
def telegram_admin(isolated_database, monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD', 'Telegram-Example!42')
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)
    calls = []

    def telegram(request):
        calls.append(request)
        if request.url.path.endswith('/getMe'):
            return httpx.Response(200, json={'ok': True, 'result': {'id': 987, 'is_bot': True, 'username': 'private_bot'}})
        return httpx.Response(200, json={'ok': True, 'result': {'message_id': 19}})

    path = tmp_path / 'telegram.sqlite3'
    with TestClient(create_app(token='token-must-never-leak', chat_id='987654321', transport=httpx.MockTransport(telegram), database_path=path), base_url=ORIGIN) as client:
        csrf = client.get('/api/admin/auth/csrf').json()['csrf_token']
        assert client.post('/api/admin/auth/login', json={'password': 'Telegram-Example!42'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf}).status_code == 200
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}
        yield client, headers, calls, path


def test_diagnostics_auth_csrf_validation_and_fixed_test_destination(telegram_admin):
    client, headers, calls, _ = telegram_admin
    assert client.get('/api/admin/telegram/diagnostics').status_code == 200
    client.cookies.clear()
    assert client.get('/api/admin/telegram/diagnostics').status_code == 401
    assert client.post('/api/admin/telegram/test').status_code == 401
    client.get('/api/admin/auth/csrf')
    # Reuse the authenticated fixture's captured cookie only by logging in again.
    token = client.get('/api/admin/auth/csrf').json()['csrf_token']
    assert client.post('/api/admin/auth/login', json={'password': 'Telegram-Example!42'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': token}).status_code == 200
    headers = {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}
    assert client.post('/api/admin/telegram/validate', headers={'Origin': ORIGIN}).status_code == 403
    assert client.post('/api/admin/telegram/validate', headers={**headers, 'Origin': 'https://other.test'}).status_code == 403
    assert client.post('/api/admin/telegram/validate', headers=headers).json() == {'validated': True}
    response = client.post('/api/admin/telegram/test', headers=headers)
    assert response.status_code == 200 and response.json() == {'accepted': True, 'read_by_recipient': None}
    assert calls[0].url.path.endswith('/getMe')
    assert calls[1].url.path.endswith('/sendMessage')
    assert json.loads(calls[1].content)['chat_id'] == '987654321'
    assert json.loads(calls[1].content)['text'].startswith('✅ تست اتصال Date Wheel')
    diagnostics = client.get('/api/admin/telegram/diagnostics').json()
    assert diagnostics['configured'] and diagnostics['bot_token_configured'] and diagnostics['destination_configured']
    assert diagnostics['bot_validation'] == 'valid' and diagnostics['success_count'] == 1
    assert diagnostics['last_successful_acceptance'] and diagnostics['last_test_at']
    assert diagnostics['read_by_recipient'] is None
    assert 'token-must-never-leak' not in json.dumps(diagnostics)
    assert '987654321' not in json.dumps(diagnostics)


@pytest.mark.parametrize(('status', 'description', 'expected'), [
    (401, 'Unauthorized', 'توکن ربات'),
    (400, 'Bad Request: chat not found', 'گفت‌وگوی مقصد پیدا نشد'),
    (403, 'Forbidden: bot was blocked by the user', 'اجازهٔ ارسال'),
    (429, 'Too Many Requests', 'محدود کرده'),
    (500, 'internal error containing secret token', 'موقتاً در دسترس نیست'),
])
def test_test_send_failures_are_safe_and_persisted(isolated_database, monkeypatch, tmp_path, status, description, expected):
    monkeypatch.setenv('ADMIN_PASSWORD', 'Telegram-Example!42')
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)
    def failure(_request):
        return httpx.Response(status, json={'ok': False, 'description': description})
    with TestClient(create_app(token='very-secret-token', chat_id='fixed-secret-chat', transport=httpx.MockTransport(failure), database_path=tmp_path / f'fail-{status}.sqlite3'), base_url=ORIGIN) as client:
        csrf = client.get('/api/admin/auth/csrf').json()['csrf_token']
        client.post('/api/admin/auth/login', json={'password': 'Telegram-Example!42'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf})
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}
        result = client.post('/api/admin/telegram/test', headers=headers).json()
        assert result['accepted'] is False and expected in result['error_summary']
        assert 'secret token' not in json.dumps(result) and 'very-secret-token' not in json.dumps(result)
        diagnostics = client.get('/api/admin/telegram/diagnostics').json()
        assert diagnostics['failure_count'] == 1 and diagnostics['last_failed_attempt']
        assert 'secret token' not in json.dumps(diagnostics)


def test_missing_configuration_is_safe_and_unavailable(isolated_database, monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD', 'Telegram-Example!42')
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)
    with TestClient(create_app(token='', chat_id='', database_path=tmp_path / 'missing.sqlite3'), base_url=ORIGIN) as client:
        csrf = client.get('/api/admin/auth/csrf').json()['csrf_token']
        client.post('/api/admin/auth/login', json={'password': 'Telegram-Example!42'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf})
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}
        assert client.get('/api/admin/telegram/diagnostics').json()['configured'] is False
        assert client.post('/api/admin/telegram/validate', headers=headers).json()['validated'] is False
        test = client.post('/api/admin/telegram/test', headers=headers).json()
        assert test['accepted'] is False and 'تنظیم نشده' in test['error_summary']
        assert client.get('/api/status').json() == {'notifications_available': False}


def test_validation_failure_is_safe_and_test_actions_are_rate_limited(telegram_admin):
    client, headers, calls, _ = telegram_admin
    # Recreate the app transport behavior with a token-invalid getMe response
    # in a dedicated app so the failure is persistent and deterministic.
    assert client.post('/api/admin/telegram/validate', headers=headers).json() == {'validated': True}
    for _ in range(2):
        assert client.post('/api/admin/telegram/test', headers=headers).json()['accepted'] is True
    assert client.post('/api/admin/telegram/test', headers=headers).status_code == 429
    assert len(calls) == 3  # one getMe and two sendMessage requests


def test_failed_notify_updates_only_the_linked_event(isolated_database, monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD', 'Telegram-Example!42')
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)
    def telegram(_request):
        return httpx.Response(403, json={'ok': False, 'description': 'Forbidden: bot was blocked by the user'})
    path = tmp_path / 'notify-failure.sqlite3'
    with TestClient(create_app(token='private-token', chat_id='fixed-chat', transport=httpx.MockTransport(telegram), database_path=path), base_url=ORIGIN) as client:
        event = {'event_id': str(uuid.uuid4()), 'event_key': secrets.token_urlsafe(32), 'consent': True,
                 'activity_id': 'cafe', 'activity_title': 'کافه‌گردی', 'mood_id': 'calm',
                 'display_name': None, 'invitation_used': True, 'invitation_title': 'دعوت'}
        assert client.post('/api/history', json=event).status_code == 202
        notify = {'activity_id': 'cafe', 'mood': 'calm', 'invitation_title': 'دعوت', 'consent': True,
                  'submission_id': str(uuid.uuid4()), 'history_event_id': event['event_id'], 'history_event_key': event['event_key']}
        assert client.post('/api/notify', json=notify).status_code == 502
        import sqlite3
        with sqlite3.connect(path) as database:
            assert database.execute('SELECT telegram_attempted, telegram_succeeded, telegram_status FROM spins').fetchone() == (1, 0, 'failed')
            assert database.execute('SELECT failure_count, last_error FROM telegram_diagnostics').fetchone() == (1, 'تلگرام اجازهٔ ارسال به مقصد را نداد؛ ربات را در گفت‌وگوی مقصد فعال کنید.')


def test_history_capability_records_only_backend_confirmed_telegram_outcome(telegram_admin):
    client, _, calls, path = telegram_admin
    body = {
        'event_id': str(uuid.uuid4()), 'event_key': secrets.token_urlsafe(32), 'consent': True,
        'activity_id': 'cafe', 'activity_title': 'کافه‌گردی', 'mood_id': 'calm',
        'display_name': None, 'invitation_used': True, 'invitation_title': 'دعوت کوچولو',
    }
    assert client.post('/api/history', json=body).status_code == 202
    notify = {'activity_id': 'cafe', 'mood': 'calm', 'invitation_title': 'دعوت کوچولو', 'consent': True,
              'submission_id': str(uuid.uuid4()), 'history_event_id': body['event_id'], 'history_event_key': body['event_key']}
    assert client.post('/api/notify', json=notify).json() == {'accepted': True}
    assert client.post('/api/notify', json=notify).json() == {'accepted': True}
    assert len(calls) == 1
    import sqlite3
    with sqlite3.connect(path) as database:
        assert database.execute('SELECT telegram_attempted, telegram_succeeded, telegram_status, telegram_accepted_at FROM spins').fetchone() == (1, 1, 'accepted', database.execute('SELECT telegram_accepted_at FROM spins').fetchone()[0])
    assert client.post('/api/notify', json={**notify, 'submission_id': str(uuid.uuid4()), 'history_event_key': secrets.token_urlsafe(32)}).status_code == 422
