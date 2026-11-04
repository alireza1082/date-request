"""Persistent Party scenario contract and protected admin management tests."""
import io
import secrets
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.storage import connect_database, initialize

ORIGIN = 'https://party.example.test'
PASSWORD = 'Party-Test-Password!46'


@pytest.fixture
def party_client(monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD', PASSWORD)
    monkeypatch.setenv('ADMIN_SESSION_SECRET', secrets.token_urlsafe(48))
    monkeypatch.setenv('ADMIN_ORIGIN', ORIGIN)
    app = create_app(database_path=tmp_path / 'party.sqlite3')
    app.state.test_database_path = tmp_path / 'party.sqlite3'
    with TestClient(app, base_url=ORIGIN) as client:
        yield client


def admin_headers(client):
    csrf = client.get('/api/admin/auth/csrf').json()['csrf_token']
    assert client.post('/api/admin/auth/login', json={'password': PASSWORD}, headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf}).status_code == 200
    return {'Origin': ORIGIN, 'X-CSRF-Token': client.get('/api/admin/auth/csrf').json()['csrf_token']}


def test_public_scenario_library_is_seeded_and_admin_is_protected(party_client):
    response = party_client.get('/api/party')
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['selection_mode'] == 'random'
    scenarios = response.json()['scenarios']
    assert len(scenarios) == 7
    assert scenarios[-1]['id'] == 'dance-and-lights'
    assert 'شب رقص و نور' in scenarios[-1]['title']
    assert all('enabled' not in item and 'archived' not in item for item in scenarios)
    assert party_client.get('/api/admin/party/scenarios').status_code == 401
    assert party_client.post('/api/admin/party/scenarios', json={}).status_code == 401


def test_scenario_crud_activation_random_pool_and_fixed_result(party_client):
    headers = admin_headers(party_client)
    payload = {
        'id': 'starlight-night', 'title': 'شب ستاره‌ای', 'headline': 'امشب آسمون نزدیکه!',
        'description': 'یک برنامهٔ تازه برای دو نفر.', 'alt': 'یک اتاق شبانه با ستاره‌های رنگی و یک میز کوچک',
        'steps': ['فضا را مرتب کنید.', 'موسیقی انتخاب کنید.', 'نوشیدنی آماده کنید.', 'شب را شروع کنید.'],
        'artwork_key': 'dance-and-lights', 'enabled': False,
    }
    created = party_client.post('/api/admin/party/scenarios', json=payload, headers=headers)
    assert created.status_code == 201
    assert created.json()['enabled'] is False
    assert party_client.patch('/api/admin/party/scenarios/starlight-night', json={'enabled': True}, headers={'Origin': ORIGIN}).status_code == 403
    enabled = party_client.patch('/api/admin/party/scenarios/starlight-night', json={'enabled': True}, headers=headers)
    assert enabled.status_code == 200 and enabled.json()['enabled'] is True

    update = {'title': 'شب ستاره و نور', 'description': 'موزیک و نورهای دلنشین، یک شب دونفره.'}
    assert party_client.patch('/api/admin/party/scenarios/starlight-night', json=update, headers=headers).json()['id'] == 'starlight-night'
    public = party_client.get('/api/party').json()
    assert any(item['id'] == 'starlight-night' and item['title'] == 'شب ستاره و نور' for item in public['scenarios'])

    selection = party_client.patch('/api/admin/party/selection', json={'mode': 'fixed', 'fixed_scenario_id': 'starlight-night'}, headers=headers)
    assert selection.status_code == 200
    fixed = party_client.get('/api/party').json()
    assert fixed['selection_mode'] == 'fixed'
    assert [item['id'] for item in fixed['scenarios']] == ['starlight-night']
    assert party_client.patch('/api/admin/party/scenarios/starlight-night', json={'enabled': False}, headers=headers).status_code == 409
    assert party_client.delete('/api/admin/party/scenarios/starlight-night', headers=headers).status_code == 409

    assert party_client.patch('/api/admin/party/selection', json={'mode': 'random'}, headers=headers).status_code == 200
    assert party_client.patch('/api/admin/party/scenarios/starlight-night', json={'enabled': False}, headers=headers).status_code == 200
    assert all(item['id'] != 'starlight-night' for item in party_client.get('/api/party').json()['scenarios'])
    assert party_client.delete('/api/admin/party/scenarios/starlight-night', headers=headers).status_code == 204
    assert all(item['id'] != 'starlight-night' for item in party_client.get('/api/admin/party/scenarios').json()['scenarios'])


def test_invalid_content_selection_and_csrf_are_rejected_without_partial_write(party_client):
    headers = admin_headers(party_client)
    invalid = {
        'id': 'bad-scenario', 'title': '<script>', 'headline': 'تیتر', 'description': 'توضیح',
        'alt': 'توضیح تصویر معتبر', 'steps': ['۱', '۲', '۳'], 'artwork_key': '../outside', 'enabled': True,
    }
    assert party_client.post('/api/admin/party/scenarios', json=invalid, headers=headers).status_code == 422
    assert party_client.get('/api/admin/party/scenarios').json()['scenarios'].__len__() == 7
    assert party_client.patch('/api/admin/party/selection', json={'mode': 'fixed'}, headers=headers).status_code == 422
    assert party_client.patch('/api/admin/party/selection', json={'mode': 'fixed', 'fixed_scenario_id': 'missing'}, headers=headers).status_code == 409
    assert party_client.patch('/api/admin/party/selection', json={'mode': 'fixed', 'fixed_scenario_id': 'neon-night'}, headers=headers).status_code == 200
    assert party_client.patch('/api/admin/party/selection', json={'mode': 'random'}, headers={'Origin': ORIGIN, 'X-CSRF-Token': '0' * 64}).status_code == 403
    assert party_client.get('/api/party').json()['scenarios'][0]['id'] == 'neon-night'
    unsafe_patch = party_client.patch('/api/admin/party/scenarios/neon-night', json={'title': '<script>alert(1)</script>'}, headers=headers)
    assert unsafe_patch.status_code == 422
    assert party_client.get('/api/admin/party/scenarios').json()['scenarios'][0]['title'] == 'شب نئون و موسیقی'


def test_mode_mutations_are_versioned_atomic_and_conflicts_are_reconciled(party_client):
    headers = admin_headers(party_client)
    settings = party_client.get('/api/admin/settings').json()
    first = party_client.patch('/api/admin/mode', json={'mode': 'party', 'expected_version': settings['mode_version']}, headers=headers)
    assert first.status_code == 200
    assert first.json()['party_enabled'] is True and first.json()['halloween_enabled'] is False
    stale = party_client.patch('/api/admin/mode', json={'mode': 'halloween', 'expected_version': settings['mode_version']}, headers=headers)
    assert stale.status_code == 409
    assert party_client.get('/api/settings').json()['party_enabled'] is True
    second = party_client.patch('/api/admin/mode', json={'mode': 'halloween', 'expected_version': first.json()['mode_version']}, headers=headers)
    assert second.status_code == 200
    assert second.json()['halloween_enabled'] is True and second.json()['party_enabled'] is False
    normal = party_client.patch('/api/admin/mode', json={'mode': 'normal', 'expected_version': second.json()['mode_version']}, headers=headers)
    assert normal.status_code == 200 and normal.json()['mode'] == 'normal'


def test_schema_seven_upgrade_seeds_without_overwriting_user_data(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    db = connect_database(path)
    with db:
        db.execute("UPDATE activities SET title='سفارشی‌شده' WHERE id='cafe'")
        db.execute("UPDATE settings SET value='متن هالووین شخصی' WHERE key='halloween_title'")
        db.execute('DROP TABLE party_scenario_steps')
        db.execute('DROP TABLE party_scenarios')
        db.execute('DROP TABLE party_media')
        db.execute("DELETE FROM settings WHERE key IN ('mode_version','party_selection_mode','party_fixed_scenario_id')")
        db.execute('PRAGMA user_version=7')
    initialize(db)
    assert db.execute('PRAGMA user_version').fetchone()[0] == 8
    assert db.execute("SELECT title FROM activities WHERE id='cafe'").fetchone()[0] == 'سفارشی‌شده'
    assert db.execute("SELECT value FROM settings WHERE key='halloween_title'").fetchone()[0] == 'متن هالووین شخصی'
    assert db.execute('SELECT count(*) FROM party_scenarios').fetchone()[0] == 7
    with db:
        db.execute("UPDATE party_scenarios SET title='متن مدیر' WHERE id='neon-night'")
    initialize(db)
    assert db.execute("SELECT title FROM party_scenarios WHERE id='neon-night'").fetchone()[0] == 'متن مدیر'
    db.close()


def test_image_upload_rejects_spoofed_format_and_path_traversal(party_client):
    headers = admin_headers(party_client)
    assert party_client.post('/api/admin/party/scenarios/neon-night/image', content=b'<svg/>', headers={**headers, 'Content-Type': 'image/svg+xml'}).status_code == 422
    assert party_client.post('/api/admin/party/scenarios/../image', content=b'not an image', headers=headers).status_code in (404, 405, 422)


def test_image_upload_reencodes_and_survives_restart(party_client):
    Image = pytest.importorskip('PIL.Image')
    headers = admin_headers(party_client)
    image = Image.new('RGB', (64, 48), '#aa6688')
    content = io.BytesIO()
    image.save(content, format='PNG')
    response = party_client.post('/api/admin/party/scenarios/neon-night/image', content=content.getvalue(), headers={**headers, 'Content-Type': 'application/octet-stream'})
    assert response.status_code == 200
    media_url = response.json()['image_url']
    assert media_url
    media = party_client.get(media_url)
    assert media.status_code == 200 and media.headers['content-type'] == 'image/webp'
    assert media.headers['x-content-type-options'] == 'nosniff'
    assert media.content[:4] == b'RIFF'
    original_media_id = media_url.rsplit('/', 1)[-1]
    replacement = io.BytesIO()
    Image.new('RGB', (80, 60), '#566688').save(replacement, format='PNG')
    replaced = party_client.post('/api/admin/party/scenarios/neon-night/image', content=replacement.getvalue(), headers={**headers, 'Content-Type': 'application/octet-stream'})
    assert replaced.status_code == 200
    replacement_media = party_client.get(replaced.json()['image_url'])
    assert replacement_media.status_code == 200 and replacement_media.headers['content-type'] == 'image/webp'
    # An already-loaded public snapshot can still render its immutable artwork.
    assert party_client.get(f'/api/party/media/{original_media_id}').content == media.content
    path = party_client.app.state.test_database_path
    with TestClient(create_app(database_path=path), base_url=ORIGIN) as restarted:
        persisted = restarted.get(replaced.json()['image_url'])
        assert persisted.status_code == 200 and persisted.content == replacement_media.content
