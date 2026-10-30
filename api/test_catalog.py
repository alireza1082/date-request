import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.storage import CATALOG_PATH, connect_database


def test_startup_seeds_and_catalog_preserves_current_data(tmp_path):
    path = tmp_path / 'nested' / 'catalog.sqlite3'
    expected = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
    app = create_app(database_path=path)
    with TestClient(app) as client:
        response = client.get('/api/catalog')
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        result = response.json()
        assert result['moods'] == expected['moods']
        assert len(result['activities']) == len(expected['activities'])
        for index, (actual, original) in enumerate(zip(result['activities'], expected['activities'])):
            assert {key: actual[key] for key in original} == original
            assert actual['sortOrder'] == index
            assert actual['icon'] == original['id']
            assert set(actual['moods']) == {mood['id'] for mood in expected['moods'] if actual['id'] in mood['activities']}
    assert app.state.database is None
    assert path.is_file()


def test_restarts_preserve_edits_memberships_order_and_disabled_state(tmp_path):
    path = tmp_path / 'catalog.sqlite3'
    with TestClient(create_app(database_path=path)) as client:
        assert len(client.get('/api/catalog').json()['activities']) == 10
    connection = connect_database(path)
    with connection:
        connection.execute("UPDATE activities SET title='عنوان تازه', description='توضیح تازه', suggestion='پیشنهاد تازه', icon='museum', sort_order=-1 WHERE id='cafe'")
        connection.execute("UPDATE activities SET enabled=0 WHERE id='cinema'")
        connection.execute("DELETE FROM activity_moods WHERE activity_id='cafe' AND mood_id='calm'")
    connection.close()
    for _ in range(2):
        with TestClient(create_app(database_path=path)) as client:
            result = client.get('/api/catalog').json()
            assert len(result['activities']) == 9
            cafe = result['activities'][0]
            assert cafe['id'] == 'cafe' and cafe['title'] == 'عنوان تازه'
            assert cafe['description'] == 'توضیح تازه' and cafe['suggestion'] == 'پیشنهاد تازه'
            assert cafe['icon'] == 'museum' and cafe['moods'] == ['surprise']
            assert all('cinema' not in mood['activities'] for mood in result['moods'])
            assert 'cafe' not in next(mood['activities'] for mood in result['moods'] if mood['id'] == 'calm')
    connection = sqlite3.connect(path)
    assert connection.execute('SELECT count(*) FROM activities').fetchone()[0] == 10
    connection.close()


def test_startup_rejects_newer_schema_without_replacing_data(tmp_path):
    path = tmp_path / 'newer.sqlite3'
    connection = sqlite3.connect(path)
    connection.execute('PRAGMA user_version=3')
    connection.execute('CREATE TABLE keep (value TEXT)')
    connection.execute("INSERT INTO keep VALUES ('original')")
    connection.commit()
    connection.close()
    with pytest.raises(RuntimeError, match='newer'):
        with TestClient(create_app(database_path=path)):
            pass
    connection = sqlite3.connect(path)
    assert connection.execute('PRAGMA user_version').fetchone()[0] == 3
    assert connection.execute('SELECT value FROM keep').fetchone()[0] == 'original'
    connection.close()


def test_unavailable_database_path_fails_startup(tmp_path):
    parent = tmp_path / 'not-a-directory'
    parent.write_text('keep', encoding='utf-8')
    with pytest.raises(FileExistsError):
        with TestClient(create_app(database_path=parent / 'catalog.sqlite3')):
            pass
    assert parent.read_text() == 'keep'


def test_query_failure_returns_error_without_hardcoded_fallback(tmp_path):
    app = create_app(database_path=tmp_path / 'catalog.sqlite3')
    with TestClient(app) as client:
        connection = sqlite3.connect(tmp_path / 'catalog.sqlite3')
        connection.execute('DROP TABLE activity_moods')
        connection.close()
        response = client.get('/api/catalog')
        assert response.status_code == 503
        assert response.json() == {'detail': 'Activity catalog is unavailable.'}


def test_equal_sort_orders_have_stable_id_order(tmp_path):
    path = tmp_path / 'catalog.sqlite3'
    connection = connect_database(path)
    with connection:
        connection.execute('UPDATE activities SET sort_order=0')
    connection.close()
    with TestClient(create_app(database_path=path)) as client:
        ids = [item['id'] for item in client.get('/api/catalog').json()['activities']]
        assert ids == sorted(ids)
