from datetime import datetime, timedelta, timezone
import secrets
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

from api.history import cleanup_expired, timestamp
from api.main import create_app
from api.storage import connect_database, initialize

ORIGIN = 'https://history.example.test'


def event(**changes):
    return {
        'event_id': str(uuid.uuid4()), 'event_key': secrets.token_urlsafe(32),
        'consent': True, 'activity_id': 'cafe', 'activity_title': 'کافه‌گردی',
        'mood_id': 'calm', 'display_name': 'همراه', 'invitation_used': False,
        'invitation_title': '', **changes,
    }


@pytest.fixture
def app_client(isolated_database, monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD', 'History-Example!42')
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)
    path = tmp_path / 'history.sqlite3'
    with TestClient(create_app(database_path=path), base_url=ORIGIN) as client:
        token = client.get('/api/admin/auth/csrf').json()['csrf_token']
        assert client.post('/api/admin/auth/login', json={'password': 'History-Example!42'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': token}).status_code == 200
        admin_headers = {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}
        yield client, admin_headers, path


def test_submit_is_opt_in_idempotent_and_persists_client_snapshot(app_client):
    client, _, path = app_client
    body = event()
    response = client.post('/api/history', json=body)
    assert response.status_code == 202
    assert response.json()['recorded'] is True and response.json()['duplicate'] is False
    assert 'display_name' not in response.json()
    assert client.post('/api/history', json=body).json()['duplicate'] is True
    assert client.post('/api/history', json={**body, 'activity_title': 'عنوان دیگری'}).status_code == 409
    with sqlite3.connect(path) as database:
        assert database.execute('SELECT display_name, activity_title, mood_id, invitation_used, telegram_status FROM spins').fetchone() == ('همراه', 'کافه‌گردی', 'calm', 0, 'not_sent')
    with TestClient(create_app(database_path=path), base_url=ORIGIN) as restarted:
        assert restarted.post('/api/history', json=body).json()['duplicate'] is True


@pytest.mark.parametrize('change', [
    {'consent': False}, {'activity_id': 'unknown'}, {'mood_id': 'invalid'},
    {'display_name': 'x' * 33}, {'activity_title': '<svg>'},
    {'invitation_title': 'title without invitation'}, {'event_key': 'bad'},
    {'event_id': 'bad'}, {'extra': 'field'},
])
def test_invalid_history_payloads_are_rejected_without_writes(app_client, change):
    client, _, path = app_client
    assert client.post('/api/history', json=event(**change)).status_code == 422
    with sqlite3.connect(path) as database:
        assert database.execute('SELECT count(*) FROM spins').fetchone()[0] == 0


def test_stale_activity_snapshot_is_accepted_only_for_reserved_ids(app_client):
    client, headers, path = app_client
    assert client.delete('/api/admin/activities/cafe', headers=headers).status_code == 204
    body = event(activity_title='عنوان هنگام چرخش')
    assert client.post('/api/history', json=body).status_code == 202
    assert client.post('/api/history', json=event(activity_id='client-invented')).status_code == 422
    with sqlite3.connect(path) as database:
        assert database.execute('SELECT activity_title FROM spins').fetchone()[0] == 'عنوان هنگام چرخش'


def test_admin_history_auth_filters_stats_and_clear_csrf(app_client):
    client, headers, _ = app_client
    first = event(display_name='اسم اختیاری', invitation_used=True, invitation_title='دعوت کوچولو')
    second = event(activity_id='cinema', activity_title='سینما', mood_id='surprise', display_name=None)
    assert client.post('/api/history', json=first).status_code == 202
    assert client.post('/api/history', json=second).status_code == 202
    client.cookies.clear()
    assert client.get('/api/admin/history').status_code == 401
    client.cookies.update({'datewheel_admin_local': ''})
    # Restore the authenticated cookie using a fresh client login.
    with TestClient(create_app(database_path=app_client[2]), base_url=ORIGIN) as admin:
        token = admin.get('/api/admin/auth/csrf').json()['csrf_token']
        assert admin.post('/api/admin/auth/login', json={'password': 'History-Example!42'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': token}).status_code == 200
        rows = admin.get('/api/admin/history', params={'mood_id': 'calm', 'invitation_used': 'true'}).json()
        assert rows['total'] == 1 and rows['items'][0]['display_name'] == 'اسم اختیاری'
        assert rows['items'][0]['reported_by_visitor'] is True
        assert admin.get('/api/admin/history', params={'page_size': 1}).json()['total'] == 2
        stats = admin.get('/api/admin/history/stats').json()
        assert stats['total_spins'] == 2 and stats['today_spins'] == 2 and stats['last_7_days'] == 2
        assert stats['invitation_spins'] == 1 and stats['mood_distribution']['calm'] == 1
        assert stats['telegram']['not_sent'] == 2
        assert admin.request('DELETE', '/api/admin/history', json={'confirmation': 'CLEAR_HISTORY'}).status_code == 403
        csrf = admin.get('/api/admin/auth/csrf').json()['csrf_token']
        assert admin.request('DELETE', '/api/admin/history', json={'confirmation': 'wrong'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf}).status_code == 422
        assert admin.request('DELETE', '/api/admin/history', json={'confirmation': 'CLEAR_HISTORY'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf}).json() == {'deleted': 2}


def test_request_size_rate_limit_and_retention(tmp_path):
    now = [100.0]
    with TestClient(create_app(database_path=tmp_path / 'bounded.sqlite3', clock=lambda: now[0], history_retention_days=30)) as client:
        assert client.post('/api/history', content='x' * 2049).status_code == 413
        for _ in range(29):
            assert client.post('/api/history', json=event()).status_code == 202
        assert client.post('/api/history', json=event()).status_code == 429
        now[0] += 10
        assert client.post('/api/history', json=event()).status_code == 202
        assert client.get('/api/admin/history').status_code == 503  # admin is safely unconfigured
        database = sqlite3.connect(tmp_path / 'bounded.sqlite3')
        with database:
            database.execute("UPDATE spins SET created_at='2020-01-01T00:00:00.000Z' WHERE id IN (SELECT id FROM spins LIMIT 3)")
        deleted = cleanup_expired(database, 30, datetime(2026, 10, 31, tzinfo=timezone.utc), limit=2)
        assert deleted == 2
        assert database.execute('SELECT count(*) FROM spins').fetchone()[0] == 28
        database.close()


def test_schema_five_migration_preserves_existing_rows_and_rejects_newer(tmp_path):
    path = tmp_path / 'migration.sqlite3'
    database = connect_database(path)
    with database:
        database.execute('DROP TABLE telegram_diagnostics')
        database.execute("INSERT INTO spins (id, created_at, display_name, mood_id, activity_id, activity_title, invitation_used, invitation_title) VALUES ('old', ?, '', 'calm', 'cafe', 'عنوان تاریخی', 0, '')", (timestamp(),))
        database.execute('DROP INDEX spins_event_key_hash')
        database.execute('DROP INDEX spins_mood_created')
        database.execute('DROP INDEX spins_activity_created')
        database.execute('DROP INDEX spins_invitation_created')
        database.execute('ALTER TABLE spins DROP COLUMN telegram_accepted_at')
        database.execute('ALTER TABLE spins DROP COLUMN telegram_status')
        database.execute('ALTER TABLE spins DROP COLUMN event_key_hash')
        database.execute('ALTER TABLE spins DROP COLUMN payload_hash')
        database.execute('PRAGMA user_version=4')
    initialize(database)
    assert database.execute('PRAGMA user_version').fetchone()[0] == 6
    assert database.execute("SELECT activity_title, telegram_status FROM spins WHERE id='old'").fetchone() == ('عنوان تاریخی', 'not_sent')
    with database:
        database.execute('PRAGMA user_version=7')
    with pytest.raises(RuntimeError, match='newer'):
        initialize(database)
    assert database.execute("SELECT activity_title FROM spins WHERE id='old'").fetchone()[0] == 'عنوان تاریخی'
    database.close()


def test_retention_configuration_is_bounded(tmp_path):
    for value in (0, 366, True):
        with pytest.raises(ValueError):
            create_app(database_path=tmp_path / f'{value}.sqlite3', history_retention_days=value)
