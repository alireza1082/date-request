import json
from pathlib import Path
import re
import secrets
import sqlite3
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from api.main import create_app

ORIGIN = 'https://activities.example.test'


def activity(**changes):
    return {'id': 'new-date', 'title': 'یک قرار تازه', 'wheelLabel': 'قرار تازه',
            'description': 'یه برنامهٔ کوچک برای امروز.', 'suggestion': 'یه چیز تازه امتحان کنین.',
            'icon': 'cafe', 'color': '#9d5862', 'moods': ['calm'], **changes}


@pytest.fixture
def admin(isolated_database, monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD', 'Activity-Editor!42')
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)
    calls = []
    def telegram(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'ok': True, 'result': {'message_id': 1}})
    path = tmp_path / 'activities.sqlite3'
    with TestClient(create_app(database_path=path, token='test-token', chat_id='123', transport=httpx.MockTransport(telegram)), base_url=ORIGIN) as client:
        csrf = client.get('/api/admin/auth/csrf').json()['csrf_token']
        response = client.post('/api/admin/auth/login', json={'password': 'Activity-Editor!42'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf})
        assert response.status_code == 200
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}
        yield client, headers, path, calls


def catalog(client):
    response = client.get('/api/catalog')
    assert response.status_code == 200
    return response.json()


def test_unauthorized_and_csrf_for_all_routes(admin):
    client, headers, _, _ = admin
    for method, path, payload in [('post', '/api/admin/activities', activity()), ('patch', '/api/admin/activities/cafe', {'title': 'تازه'}), ('post', '/api/admin/activities/reorder', {'ids': ['cafe']}), ('delete', '/api/admin/activities/cafe', None)]:
        before = catalog(client)
        for bad in ({}, {**headers, 'X-CSRF-Token': '0' * 64}, {**headers, 'Origin': 'https://other.test'}):
            response = client.request(method, path, json=payload, headers=bad)
            assert response.status_code == 403
        assert catalog(client) == before
    client.cookies.clear()
    for path in ['/api/admin/activities', '/api/admin/activities/cafe', '/api/admin/icons']:
        assert client.get(path).status_code == 401
    for method, path in [('POST', '/api/admin/activities'), ('PATCH', '/api/admin/activities/cafe'), ('DELETE', '/api/admin/activities/cafe'), ('POST', '/api/admin/activities/reorder')]:
        assert client.request(method, path, json={}, headers=headers).status_code == 401


def test_icon_catalog_matches_existing_renderable_artwork(admin):
    client, _, _, _ = admin
    response = client.get('/api/admin/icons')
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    icons = response.json()['icons']
    source = (Path(__file__).resolve().parents[1] / 'src/features/results/activity-artwork-data.ts').read_text()
    matches = re.findall(r'^  (?:(\w+)|"([\w-]+)"): `', source, re.M)
    assert {item['id'] for item in icons} == {first or second for first, second in matches}
    assert all(set(icon) == {'id', 'label', 'category'} and icon['label'] and icon['category'] for icon in icons)


def test_create_edit_live_catalog_and_telegram_use_persisted_data(admin):
    client, headers, _, calls = admin
    response = client.post('/api/admin/activities', json=activity(), headers=headers)
    assert response.status_code == 201
    assert response.json()['sortOrder'] == 10
    assert response.json()['emoji'] == '☕'
    changes = {'title': 'کتاب و یک قرار تازه', 'wheelLabel': 'کتاب تازه', 'description': 'توضیح تازه', 'suggestion': 'برای هم یه کتاب انتخاب کنین.', 'icon': 'bookshop', 'color': '#e3a280', 'moods': ['outdoor', 'surprise']}
    # surprise already has ten active options; a rejected patch changes nothing.
    before = client.get('/api/admin/activities/new-date').json()
    assert client.patch('/api/admin/activities/new-date', json=changes, headers=headers).status_code == 409
    assert client.get('/api/admin/activities/new-date').json() == before
    changes['moods'] = ['outdoor']
    response = client.patch('/api/admin/activities/new-date', json=changes, headers=headers)
    assert response.status_code == 200
    assert response.json()['ink'] == 'dark' and response.json()['emoji'] == '📚'
    public = next(item for item in catalog(client)['activities'] if item['id'] == 'new-date')
    assert public['title'] == changes['title'] and public['moods'] == ['outdoor']
    assert 'archived' not in public and 'enabled' not in public
    assert 'new-date' in next(mood['activities'] for mood in catalog(client)['moods'] if mood['id'] == 'outdoor')
    assert 'new-date' not in next(mood['activities'] for mood in catalog(client)['moods'] if mood['id'] == 'calm')
    body = {'activity_id': 'new-date', 'mood': 'outdoor', 'consent': True, 'submission_id': str(uuid.uuid4())}
    assert client.post('/api/notify', json={**body, 'mood': 'calm'}).status_code == 422
    assert client.post('/api/notify', json=body).json() == {'accepted': True}
    assert len(calls) == 1
    assert changes['title'] in calls[0]['text'] and changes['suggestion'] in calls[0]['text']
    assert client.patch('/api/admin/activities/new-date', json={'enabled': False}, headers=headers).status_code == 200
    assert client.post('/api/notify', json={**body, 'submission_id': str(uuid.uuid4())}).status_code == 422
    assert len(calls) == 1


def test_disabled_drafts_enable_and_sort_order(admin):
    client, headers, _, _ = admin
    assert client.post('/api/admin/activities', json=activity(enabled=False, moods=['surprise']), headers=headers).status_code == 201
    assert all(item['id'] != 'new-date' for item in catalog(client)['activities'])
    assert client.patch('/api/admin/activities/new-date', json={'enabled': True}, headers=headers).status_code == 409
    assert client.patch('/api/admin/activities/new-date', json={'moods': ['calm', 'outdoor'], 'enabled': True, 'sortOrder': 0}, headers=headers).status_code == 200
    items = catalog(client)['activities']
    assert [item['id'] for item in items[:2]] == ['cafe', 'new-date']
    assert client.get('/api/admin/activities/new-date').json()['enabled'] is True


def test_archive_restore_reserved_id_and_restart_persistence(admin):
    client, headers, path, _ = admin
    assert client.post('/api/admin/activities', json=activity(), headers=headers).status_code == 201
    assert client.delete('/api/admin/activities/new-date', headers=headers).status_code == 204
    assert client.delete('/api/admin/activities/new-date', headers=headers).status_code == 204
    archived = client.get('/api/admin/activities/new-date').json()
    assert archived['archived'] is True and archived['enabled'] is False
    assert len(client.get('/api/admin/activities').json()['activities']) == 11
    assert len(catalog(client)['activities']) == 10
    assert client.post('/api/admin/activities', json=activity(), headers=headers).status_code == 409
    assert client.patch('/api/admin/activities/new-date', json={'enabled': True}, headers=headers).status_code == 409
    with TestClient(create_app(database_path=path), base_url=ORIGIN) as other:
        other.cookies.update(client.cookies)
        assert len(catalog(other)['activities']) == 10
        assert other.get('/api/admin/activities/new-date').json()['archived'] is True
    assert client.patch('/api/admin/activities/new-date', json={'archived': False, 'enabled': True}, headers=headers).status_code == 200
    assert len(catalog(client)['activities']) == 11


def test_reorder_requires_complete_unique_nonarchived_set(admin):
    client, headers, _, _ = admin
    before = catalog(client)
    ids = [item['id'] for item in before['activities']]
    for bad, status in [([ids[0]], 409), (ids[:-1] + ['unknown'], 409), ([ids[0], ids[0]], 422)]:
        assert client.post('/api/admin/activities/reorder', json={'ids': bad}, headers=headers).status_code == status
        assert catalog(client) == before
    assert client.patch('/api/admin/activities/cafe', json={'enabled': False}, headers=headers).status_code == 200
    reordered = list(reversed(ids))
    response = client.post('/api/admin/activities/reorder', json={'ids': reordered}, headers=headers)
    assert response.status_code == 200
    assert [item['id'] for item in response.json()['activities']] == reordered
    assert [item['sortOrder'] for item in response.json()['activities']] == list(range(10))
    assert [item['id'] for item in catalog(client)['activities']] == [item for item in reordered if item != 'cafe']


@pytest.mark.parametrize('change', [
    {'id': 'bad id'}, {'id': 'a' * 33}, {'title': ' '}, {'title': 'الف' * 30},
    {'wheelLabel': 'الف' * 5}, {'description': '<script>alert(1)</script>'},
    {'suggestion': '\u202ebad'}, {'icon': 'coffee'}, {'icon': '<svg/>'},
    {'color': '#000000'}, {'color': 'url(https://evil.test)'}, {'moods': []},
    {'moods': ['calm', 'calm']}, {'moods': ['unknown']}, {'enabled': 1},
    {'sortOrder': -1}, {'ink': 'dark'}, {'emoji': 'custom'},
])
def test_invalid_creation_is_rejected_without_changes(admin, change):
    client, headers, _, _ = admin
    before = catalog(client)
    response = client.post('/api/admin/activities', json=activity(**change), headers=headers)
    assert response.status_code == 422
    assert catalog(client) == before


@pytest.mark.parametrize('change', [{'id': 'renamed'}, {'title': None}, {'moods': ['calm', 'calm']}, {'icon': 'ghost'}, {'color': '#ffffff'}, {'title': 'x' * 81}, {'sortOrder': True}, {}])
def test_invalid_patch_preserves_id_and_record(admin, change):
    client, headers, _, _ = admin
    before = client.get('/api/admin/activities/cafe').json()
    assert client.patch('/api/admin/activities/cafe', json=change, headers=headers).status_code == 422
    assert client.get('/api/admin/activities/cafe').json() == before


def test_minimum_mood_count_blocks_disable_archive_and_membership_removal(admin):
    client, headers, _, _ = admin
    for activity_id in ('cafe', 'ice-cream', 'breakfast'):
        assert client.patch('/api/admin/activities/' + activity_id, json={'enabled': False}, headers=headers).status_code == 200
    before = catalog(client)
    assert client.patch('/api/admin/activities/walk', json={'enabled': False}, headers=headers).status_code == 409
    assert client.delete('/api/admin/activities/walk', headers=headers).status_code == 409
    assert client.patch('/api/admin/activities/bookshop', json={'moods': ['surprise']}, headers=headers).status_code == 409
    assert catalog(client) == before
    assert client.get('/api/admin/activities/walk').json()['archived'] is False


def test_sql_failure_rolls_back_insert_and_invalid_public_state_has_no_fallback(admin):
    client, headers, path, _ = admin
    connection = sqlite3.connect(path)
    connection.execute("CREATE TRIGGER reject_membership BEFORE INSERT ON activity_moods WHEN NEW.activity_id='reject-me' BEGIN SELECT RAISE(ABORT, 'forced'); END")
    connection.close()
    assert client.post('/api/admin/activities', json=activity(id='reject-me'), headers=headers).status_code == 409
    assert client.get('/api/admin/activities/reject-me').status_code == 404
    assert len(catalog(client)['activities']) == 10
    connection = sqlite3.connect(path)
    with connection:
        connection.execute('UPDATE activities SET enabled=0')
    connection.close()
    assert client.get('/api/catalog').status_code == 503


def test_unknown_records_and_draft_limit(admin):
    client, headers, _, _ = admin
    assert client.get('/api/admin/activities/missing').status_code == 404
    assert client.patch('/api/admin/activities/missing', json={'title': 'تازه'}, headers=headers).status_code == 404
    assert client.delete('/api/admin/activities/missing', headers=headers).status_code == 404
    for index in range(30):
        assert client.post('/api/admin/activities', json=activity(id=f'draft-{index}', enabled=False), headers=headers).status_code == 201
    assert client.post('/api/admin/activities', json=activity(id='one-too-many', enabled=False), headers=headers).status_code == 409
    assert len(client.get('/api/admin/activities').json()['activities']) == 40


def test_database_read_failures_do_not_fall_back_to_static_catalog(admin):
    client, _, path, calls = admin
    connection = sqlite3.connect(path)
    connection.execute('DROP TABLE activity_moods')
    connection.close()
    assert client.get('/api/admin/activities').status_code == 503
    assert client.get('/api/admin/activities/cafe').status_code == 503
    assert client.get('/api/catalog').status_code == 503
    assert client.post('/api/notify', json={'activity_id': 'cafe', 'mood': 'calm', 'consent': True, 'submission_id': str(uuid.uuid4())}).status_code == 503
    assert calls == []


def test_color_normalization_and_append_limit_rollback(admin):
    client, headers, _, _ = admin
    assert client.patch('/api/admin/activities/cafe', json={'sortOrder': 10000}, headers=headers).status_code == 200
    response = client.post('/api/admin/activities', json=activity(), headers=headers)
    assert response.status_code == 409
    assert client.get('/api/admin/activities/new-date').status_code == 404
    response = client.post('/api/admin/activities', json=activity(sortOrder=0, color='#E3A280'), headers=headers)
    assert response.status_code == 201
    assert response.json()['color'] == '#e3a280' and response.json()['ink'] == 'dark'
