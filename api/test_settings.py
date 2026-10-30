import secrets

import pytest
from fastapi.testclient import TestClient

from api.main import create_app


@pytest.fixture
def configured(isolated_database, monkeypatch):
    monkeypatch.setenv('ADMIN_PASSWORD', 'Settings-Example!42')
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', 'https://settings.example.test')


def test_settings_auth_csrf_persistence_and_public_visibility(configured, tmp_path):
    path = tmp_path / 'settings.sqlite3'
    origin = 'https://settings.example.test'
    with TestClient(create_app(database_path=path), base_url=origin) as client:
        response = client.get('/api/settings')
        assert response.status_code == 200 and response.json()['halloween_enabled'] is False
        assert response.headers['cache-control'] == 'no-store'
        assert client.get('/api/admin/settings').status_code == 401
        assert client.patch('/api/admin/settings', json={'halloween_enabled': True}).status_code == 401
        token = client.get('/api/admin/auth/csrf').json()['csrf_token']
        response = client.post('/api/admin/auth/login', json={'password': 'Settings-Example!42'}, headers={'Origin': origin, 'X-CSRF-Token': token})
        assert response.status_code == 200
        token = client.get('/api/admin/auth/csrf').json()['csrf_token']
        headers = {'Origin': origin, 'X-CSRF-Token': token}
        assert client.patch('/api/admin/settings', json={'halloween_enabled': True}, headers={'Origin': origin}).status_code == 403
        assert client.patch('/api/admin/settings', json={'halloween_enabled': True}, headers={**headers, 'Origin': 'https://other.example'}).status_code == 403
        assert client.get('/api/admin/settings').headers['cache-control'] == 'no-store'
        for payload in ({'halloween_enabled': 1}, {'halloween_title': '<script>'}, {'halloween_subtitle': 'https://evil.test'}, {'halloween_note': None}, {'unknown': True}, {'halloween_title': 'x' * 81}):
            assert client.patch('/api/admin/settings', json=payload, headers=headers).status_code == 422
        assert client.get('/api/settings').json()['halloween_enabled'] is False
        response = client.patch('/api/admin/settings', json={'halloween_enabled': True, 'halloween_title': 'شب پاییزی'}, headers=headers)
        assert response.status_code == 200
        assert client.get('/api/settings').json()['halloween_title'] == 'شب پاییزی'
    with TestClient(create_app(database_path=path), base_url=origin) as client:
        settings = client.get('/api/settings').json()
        assert settings['halloween_enabled'] is True and settings['halloween_title'] == 'شب پاییزی'


def test_schema_three_upgrade_preserves_existing_data_and_adds_only_missing_defaults(tmp_path):
    import sqlite3
    from api.seasonal_defaults import DEFAULTS
    from api.storage import connect_database, initialize

    path = tmp_path / 'migration.sqlite3'
    database = connect_database(path)
    with database:
        database.execute("DELETE FROM settings WHERE key != 'halloween_enabled'")
        database.execute("UPDATE settings SET value='true' WHERE key='halloween_enabled'")
        database.execute("INSERT INTO settings VALUES ('halloween_title', 'متن قبلی')")
        database.execute("UPDATE activities SET title='قرار قبلی', archived=1 WHERE id='cafe'")
        database.execute("INSERT INTO admin_sessions VALUES ('hash', 'version', 1, 2)")
        database.execute('PRAGMA user_version=3')
    initialize(database)
    assert database.execute('PRAGMA user_version').fetchone()[0] == 4
    rows = dict(database.execute('SELECT key, value FROM settings'))
    assert rows['halloween_enabled'] == 'true' and rows['halloween_title'] == 'متن قبلی'
    assert set(DEFAULTS) <= rows.keys()
    assert database.execute("SELECT title, archived FROM activities WHERE id='cafe'").fetchone() == ('قرار قبلی', 1)
    assert database.execute('SELECT count(*) FROM admin_sessions').fetchone()[0] == 1
    initialize(database)
    assert dict(database.execute('SELECT key, value FROM settings')) == rows
    database.close()


def test_schema_four_migration_rolls_back_on_failure(tmp_path):
    import sqlite3
    from api.storage import connect_database, initialize

    database = connect_database(tmp_path / 'failure.sqlite3')
    with database:
        database.execute("DELETE FROM settings WHERE key != 'halloween_enabled'")
        database.execute('PRAGMA user_version=3')
        database.execute("CREATE TRIGGER fail_settings BEFORE INSERT ON settings WHEN NEW.key='halloween_cta' BEGIN SELECT RAISE(ABORT, 'forced'); END")
    with pytest.raises(sqlite3.IntegrityError):
        initialize(database)
    assert database.execute('PRAGMA user_version').fetchone()[0] == 3
    assert database.execute('SELECT key FROM settings').fetchall() == [('halloween_enabled',)]
    database.close()


@pytest.mark.parametrize("key", ["halloween_enabled", "halloween_title"])
def test_corrupted_settings_fail_closed(configured, tmp_path, key):
    import sqlite3
    path = tmp_path / 'corrupt.sqlite3'
    with TestClient(create_app(database_path=path), base_url='https://settings.example.test') as client:
        connection = sqlite3.connect(path)
        with connection:
            connection.execute("DELETE FROM settings WHERE key=?", (key,))
        connection.close()
        assert client.get('/api/settings').status_code == 503
