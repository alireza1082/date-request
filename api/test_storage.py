import sqlite3

import pytest

from api.storage import connect_database, initialize


def test_seed_persists_edits_and_does_not_reseed(tmp_path):
    path = tmp_path / 'data.sqlite3'
    connection = sqlite3.connect(path)
    initialize(connection)
    initial_count = connection.execute('SELECT count(*) FROM activities').fetchone()[0]
    assert initial_count == 10
    connection.execute("UPDATE activities SET title = 'تغییر' WHERE id = 'cafe'")
    connection.execute("DELETE FROM activity_moods WHERE activity_id = 'cafe'")
    connection.execute("DELETE FROM activities WHERE id = 'cafe'")
    connection.commit()
    connection.close()
    connection = sqlite3.connect(path)
    initialize(connection)
    assert connection.execute('SELECT count(*) FROM activities').fetchone()[0] == initial_count - 1
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 4
    connection.close()


def test_newer_database_is_rejected(tmp_path):
    connection = sqlite3.connect(tmp_path / 'data.sqlite3')
    connection.execute('PRAGMA user_version = 5')
    with pytest.raises(RuntimeError, match='newer'):
        initialize(connection)
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 5
    connection.close()


def test_open_configures_connection_and_preserves_database(tmp_path):
    path = tmp_path / 'data.sqlite3'
    connection = connect_database(path)
    assert connection.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
    assert connection.execute('PRAGMA foreign_keys').fetchone()[0] == 1
    assert connection.execute('PRAGMA busy_timeout').fetchone()[0] == 5000
    connection.execute("UPDATE activities SET title = 'تغییر' WHERE id = 'cafe'")
    connection.commit()
    connection.close()
    with connect_database(path) as reopened:
        assert reopened.execute("SELECT title FROM activities WHERE id = 'cafe'").fetchone()[0] == 'تغییر'


def test_unversioned_existing_database_is_not_modified(tmp_path):
    connection = sqlite3.connect(tmp_path / 'existing.sqlite3')
    connection.execute('CREATE TABLE important_data (value TEXT)')
    connection.execute("INSERT INTO important_data VALUES ('keep')")
    connection.commit()
    with pytest.raises(RuntimeError, match='not empty'):
        initialize(connection)
    assert connection.execute('SELECT value FROM important_data').fetchone()[0] == 'keep'
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 0
    connection.close()


def test_failed_seed_rolls_back_schema_and_version(tmp_path, monkeypatch):
    import json
    import api.storage as storage

    catalog = json.loads(storage.CATALOG_PATH.read_text(encoding='utf-8'))
    catalog['activities'].append(catalog['activities'][0])
    path = tmp_path / 'invalid.json'
    path.write_text(json.dumps(catalog), encoding='utf-8')
    monkeypatch.setattr(storage, 'CATALOG_PATH', path)
    connection = sqlite3.connect(tmp_path / 'data.sqlite3')
    with pytest.raises(sqlite3.IntegrityError):
        initialize(connection)
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 0
    assert connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
    connection.close()


def test_version_one_upgrade_preserves_all_application_data(tmp_path):
    connection = connect_database(tmp_path / 'upgrade.sqlite3')
    with connection:
        connection.execute('DROP TABLE admin_sessions')
        connection.execute('DROP TABLE admin_login_budget')
        connection.execute('ALTER TABLE activities DROP COLUMN archived')
        connection.execute('PRAGMA user_version=1')
        connection.execute("UPDATE activities SET title='عنوان حفظ‌شده', enabled=0 WHERE id='cafe'")
        connection.execute("UPDATE settings SET value='true' WHERE key='halloween_enabled'")
    before = [(*row, 0) for row in connection.execute('SELECT * FROM activities ORDER BY id').fetchall()]
    memberships = connection.execute('SELECT * FROM activity_moods ORDER BY activity_id, mood_id').fetchall()
    initialize(connection)
    assert connection.execute('SELECT * FROM activities ORDER BY id').fetchall() == before
    assert connection.execute('SELECT * FROM activity_moods ORDER BY activity_id, mood_id').fetchall() == memberships
    assert connection.execute("SELECT value FROM settings WHERE key='halloween_enabled'").fetchone()[0] == 'true'
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 4
    assert connection.execute('SELECT count(*) FROM admin_sessions').fetchone()[0] == 0
    initialize(connection)
    assert connection.execute('SELECT * FROM activities ORDER BY id').fetchall() == before
    connection.close()


def test_failed_version_two_upgrade_is_atomic(tmp_path):
    connection = connect_database(tmp_path / 'upgrade.sqlite3')
    with connection:
        connection.execute('DROP TABLE admin_sessions')
        connection.execute('ALTER TABLE activities DROP COLUMN archived')
        connection.execute('PRAGMA user_version=1')
        connection.execute("UPDATE activities SET title='حفظ شود' WHERE id='cafe'")
    with pytest.raises(sqlite3.OperationalError):
        initialize(connection)
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 1
    assert connection.execute("SELECT title FROM activities WHERE id='cafe'").fetchone()[0] == 'حفظ شود'
    assert connection.execute("SELECT name FROM sqlite_master WHERE name='admin_sessions'").fetchone() is None
    assert connection.execute("SELECT name FROM sqlite_master WHERE name='admin_login_budget'").fetchone() is not None
    connection.close()


def test_version_two_upgrade_adds_archive_without_changing_records_or_sessions(tmp_path):
    connection = connect_database(tmp_path / 'upgrade.sqlite3')
    with connection:
        connection.execute('ALTER TABLE activities DROP COLUMN archived')
        connection.execute('PRAGMA user_version=2')
        connection.execute("UPDATE activities SET title='ویرایش قبلی', enabled=0 WHERE id='cafe'")
        connection.execute("INSERT INTO admin_sessions VALUES ('hash', 'credential-version', 100, 200)")
    before = connection.execute('SELECT * FROM activities ORDER BY id').fetchall()
    initialize(connection)
    assert connection.execute('SELECT * FROM activities ORDER BY id').fetchall() == [(*row, 0) for row in before]
    assert connection.execute('SELECT * FROM admin_sessions').fetchall() == [('hash', 'credential-version', 100, 200)]
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 4
    with connection:
        connection.execute("UPDATE activities SET archived=1 WHERE id='cafe'")
    initialize(connection)
    assert connection.execute("SELECT archived FROM activities WHERE id='cafe'").fetchone()[0] == 1
    connection.close()
