import secrets
import sqlite3

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from api.auth import require_admin, require_admin_mutation, SESSION_SECONDS
from api.main import create_app

PASSWORD = 'Paper-Invitation!42'
ORIGIN = 'https://date.example.test'
COOKIE = '__Host-datewheel-admin'


@pytest.fixture
def configured(isolated_database, monkeypatch):
    monkeypatch.setenv('ADMIN_PASSWORD', PASSWORD)
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)


def login(client, password=PASSWORD):
    token = client.get('/api/admin/auth/csrf').json()['csrf_token']
    return client.post('/api/admin/auth/login', json={'password': password}, headers={'Origin': ORIGIN, 'X-CSRF-Token': token})


def csrf_headers(client):
    return {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}


def test_login_hash_only_cookie_flags_logout_and_replay(configured, tmp_path):
    path = tmp_path / 'auth.sqlite3'
    with TestClient(create_app(database_path=path), base_url=ORIGIN) as client:
        response = login(client)
        assert response.status_code == 200 and response.json() == {'authenticated': True}
        session_cookie = next(cookie for cookie in response.headers.get_list('set-cookie') if cookie.startswith(COOKIE + '='))
        assert all(flag in session_cookie.lower() for flag in ('secure', 'httponly', 'samesite=strict', 'path=/', 'max-age=28800'))
        assert 'domain=' not in session_cookie.lower()
        token = client.cookies.get(COOKIE)
        connection = sqlite3.connect(path)
        stored_hash = connection.execute('SELECT token_hash FROM admin_sessions').fetchone()[0]
        assert stored_hash != token and len(stored_hash) == 64
        assert token not in str(connection.execute('SELECT * FROM admin_sessions').fetchall())
        connection.close()
        assert token not in response.text and PASSWORD not in response.text
        assert client.get('/api/admin/auth/me').json() == {'authenticated': True}
        headers = csrf_headers(client)
        response = client.post('/api/admin/auth/logout', headers=headers)
        assert response.status_code == 200 and response.json() == {'authenticated': False}
        assert client.get('/api/admin/auth/me').status_code == 401
        client.cookies.set(COOKIE, token)
        assert client.get('/api/admin/auth/me').status_code == 401


def test_invalid_password_and_unauthorized(configured):
    with TestClient(create_app(), base_url=ORIGIN) as client:
        assert client.get('/api/admin/auth/me').status_code == 401
        response = login(client, 'incorrect-password')
        assert response.status_code == 401 and response.json() == {'detail': 'Authentication failed.'}
        assert COOKIE not in response.headers.get('set-cookie', '')
        assert PASSWORD not in response.text
        for fake in ('x' * 43, 'x'):
            client.cookies.set(COOKIE, fake)
            assert client.get('/api/admin/auth/me').status_code == 401


@pytest.mark.parametrize('env', [{}, {'ADMIN_PASSWORD': 'weak'}, {'ADMIN_SESSION_SECRET': 'short'}, {'ADMIN_SESSION_SECRET': 'x' * 64}, {'ADMIN_ORIGIN': 'http://date.example.test'}, {'ADMIN_ORIGIN': 'https://date.example.test/'}, {'ADMIN_PASSWORD': ''}, {'ADMIN_ORIGIN': 'https://user:password@date.example.test'}])
def test_disabled_or_invalid_configuration(configured, monkeypatch, env):
    if not env:
        monkeypatch.delenv('ADMIN_PASSWORD')
        monkeypatch.delenv('ADMIN_SESSION_SECRET')
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    with TestClient(create_app(), base_url=ORIGIN) as client:
        for method, path in [('get', 'me'), ('get', 'csrf'), ('post', 'login'), ('post', 'logout')]:
            response = getattr(client, method)('/api/admin/auth/' + path)
            assert response.status_code == 503
            assert response.headers['cache-control'] == 'no-store'
            assert PASSWORD not in response.text
        assert client.get('/api/catalog').status_code == 200
        assert client.get('/healthz').status_code == 200
        assert client.get('/api/status').json() == {'notifications_available': False}


def test_expiration_restart_and_secret_rotation(configured, tmp_path, monkeypatch):
    path = tmp_path / 'auth.sqlite3'
    now = [1000000.0]
    with TestClient(create_app(database_path=path, admin_clock=lambda: now[0]), base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        token = client.cookies.get(COOKIE)
    with TestClient(create_app(database_path=path, admin_clock=lambda: now[0]), base_url=ORIGIN) as client:
        client.cookies.set(COOKIE, token)
        assert client.get('/api/admin/auth/me').status_code == 200
        now[0] += SESSION_SECONDS
        assert client.get('/api/admin/auth/me').status_code == 401
        client.cookies.clear()
        assert login(client).status_code == 200
        token = client.cookies.get(COOKIE)
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    with TestClient(create_app(database_path=path, admin_clock=lambda: now[0]), base_url=ORIGIN) as client:
        client.cookies.set(COOKIE, token)
        assert client.get('/api/admin/auth/me').status_code == 401


def test_password_change_revokes_sessions(configured, tmp_path, monkeypatch):
    path = tmp_path / 'auth.sqlite3'
    with TestClient(create_app(database_path=path), base_url=ORIGIN) as client:
        assert login(client).status_code == 200
        token = client.cookies.get(COOKIE)
    monkeypatch.setenv('ADMIN_PASSWORD', 'Another-Paper!42')
    with TestClient(create_app(database_path=path), base_url=ORIGIN) as client:
        client.cookies.set(COOKIE, token)
        assert client.get('/api/admin/auth/me').status_code == 401


def test_session_bound_csrf_and_reusable_dependencies(configured):
    app = create_app()
    @app.get('/api/admin/test-read')
    async def read(_session=Depends(require_admin)):
        return {'allowed': True}
    @app.post('/api/admin/test-write')
    async def write(_session=Depends(require_admin_mutation)):
        return {'allowed': True}
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.get('/api/admin/test-read').status_code == 401
        assert client.post('/api/admin/test-write').status_code == 401
        assert login(client).status_code == 200
        assert client.get('/api/admin/test-read').status_code == 200
        headers = csrf_headers(client)
        for bad in ({'Origin': ORIGIN}, {**headers, 'X-CSRF-Token': '0' * 64}, {**headers, 'X-CSRF-Token': b'\xff' * 64}, {**headers, 'Origin': 'https://evil.test'}, {'X-CSRF-Token': headers['X-CSRF-Token']}, {**headers, 'Sec-Fetch-Site': 'cross-site'}):
            assert client.post('/api/admin/test-write', json={}, headers=bad).status_code == 403
        assert client.post('/api/admin/test-write', json={}, headers=headers).status_code == 200
        first_csrf = headers['X-CSRF-Token']
        assert client.post('/api/admin/auth/logout', headers=headers).status_code == 200
        assert login(client).status_code == 200
        assert csrf_headers(client)['X-CSRF-Token'] != first_csrf
        assert client.post('/api/admin/test-write', headers={'Origin': ORIGIN, 'X-CSRF-Token': first_csrf}).status_code == 403


def test_login_csrf_requires_challenge_origin_and_bound_header(configured):
    with TestClient(create_app(), base_url=ORIGIN) as client:
        for headers in ({}, {'Origin': ORIGIN}, {'Origin': 'https://evil.test', 'X-CSRF-Token': '0' * 64}):
            assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers=headers).status_code == 403
        assert client.get('/api/admin/auth/csrf', headers={'Origin': 'https://evil.test'}).status_code == 403
        headers = csrf_headers(client)
        assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers={**headers, 'X-CSRF-Token': '0' * 64}).status_code == 403
        assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers=headers).status_code == 200


def test_strict_validation_and_oversized_input(configured):
    with TestClient(create_app(), base_url=ORIGIN) as client:
        headers = csrf_headers(client)
        for payload in ({'password': 123}, {'password': PASSWORD, 'redirect': 'https://evil.test'}, {'password': 'x' * 129}):
            response = client.post('/api/admin/auth/login', json=payload, headers=headers)
            assert response.status_code == 422
            assert 'password' not in response.text and PASSWORD not in response.text
        response = client.post('/api/admin/auth/login', content='x' * 2049, headers=headers)
        assert response.status_code == 413
        assert response.headers['cache-control'] == 'no-store'


def test_global_rate_limit_persists_and_expires(configured, tmp_path):
    path = tmp_path / 'auth.sqlite3'
    now = [1000000.0]
    for run in range(2):
        with TestClient(create_app(database_path=path, admin_clock=lambda: now[0]), base_url=ORIGIN) as client:
            if run == 0:
                for attempt in range(5):
                    client.headers['X-Forwarded-For'] = f'198.51.100.{attempt + 1}'
                    assert login(client, 'bad').status_code == 401
            response = login(client, 'bad')
            assert response.status_code == 429 and response.headers['retry-after'] == '60'
    now[0] += 61
    with TestClient(create_app(database_path=path, admin_clock=lambda: now[0]), base_url=ORIGIN) as client:
        assert login(client).status_code == 200


def test_local_http_requires_explicit_loopback_opt_in(configured, monkeypatch):
    monkeypatch.setenv('ADMIN_ORIGIN', 'http://127.0.0.1:4173')
    with TestClient(create_app()) as client:
        assert client.get('/api/admin/auth/me').status_code == 503
    monkeypatch.setenv('ADMIN_ALLOW_INSECURE_LOCAL', 'true')
    with TestClient(create_app(), base_url='http://127.0.0.1:4173') as client:
        token = client.get('/api/admin/auth/csrf').json()['csrf_token']
        response = client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers={'Origin': 'http://127.0.0.1:4173', 'X-CSRF-Token': token})
        assert response.status_code == 200
        assert 'secure' not in response.headers['set-cookie'].lower()
        assert client.get('/api/admin/auth/me').status_code == 200


def test_expired_and_tampered_login_challenge(configured):
    now = [1000000.0]
    with TestClient(create_app(admin_clock=lambda: now[0]), base_url=ORIGIN) as client:
        headers = csrf_headers(client)
        now[0] += 301
        assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers=headers).status_code == 403
        headers = csrf_headers(client)
        challenge = client.cookies.get('__Host-datewheel-login')
        client.cookies.clear()
        client.cookies.set('__Host-datewheel-login', challenge[:-1] + ('0' if challenge[-1] != '0' else '1'))
        assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers=headers).status_code == 403


def test_login_csrf_is_bound_to_cookie(configured):
    app = create_app()
    with TestClient(app, base_url=ORIGIN) as client:
        old = csrf_headers(client)
        fresh = csrf_headers(client)
        assert old != fresh
        assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers=old).status_code == 403
        assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers=fresh).status_code == 200
        response = client.get('/api/admin/auth/csrf')
        assert client.cookies.get(COOKIE) not in response.text


def test_unicode_surrogate_password_is_rejected_safely(configured):
    with TestClient(create_app(), base_url=ORIGIN) as client:
        headers = {**csrf_headers(client), 'Content-Type': 'application/json'}
        response = client.post('/api/admin/auth/login', content=b'{"password":"\\ud800"}', headers=headers)
        assert response.status_code == 422
        assert response.json() == {'detail': 'Invalid authentication request.'}
