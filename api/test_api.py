import json
import uuid
import httpx
import pytest
from fastapi.testclient import TestClient
from api.main import create_app


def payload(**extra):
    return {'activity_id': 'cafe', 'mood': 'calm', 'consent': True,
            'submission_id': str(uuid.uuid4()), 'invitation_title': 'یه قرار', **extra}


def make_client(handler=None, **kwargs):
    handler = handler or (lambda request: httpx.Response(200, json={'ok': True, 'result': {'message_id': 1}}))
    return TestClient(create_app(token='test-token', chat_id='123', transport=httpx.MockTransport(handler), **kwargs))


def test_success_and_duplicate():
    calls = []
    def telegram(request):
        calls.append(request)
        return httpx.Response(200, json={'ok': True, 'result': {'message_id': 7}})
    with make_client(telegram) as client:
        body = payload()
        assert client.post('/api/notify', json=body).json() == {'accepted': True}
        assert client.post('/api/notify', json=body).json() == {'accepted': True}
        assert client.post('/api/notify', json={**body, 'activity_id': 'walk'}).status_code == 409
        assert len(calls) == 1
        sent = json.loads(calls[0].read())
        message = sent['text']
        assert sent['chat_id'] == '123' and 'parse_mode' not in sent
        assert 'کافه‌گردی' in message and 'یه چیز آروم' in message
        assert 'نوشیدنی تازه' in message and 'یه قرار' in message
        assert 'user_agent' not in message and 'ip_address' not in message


@pytest.mark.parametrize('extra', [
    {'activity_id': 'arbitrary'}, {'mood': 'anything'}, {'consent': False},
    {'consent': 1}, {'consent': 'true'}, {'chat_id': 'other'}, {'text': 'forward me'}, {'invitation_title': 'x' * 53},
    {'activity_id': 'bowling', 'mood': 'calm'}, {'submission_id': 'bad'},
])
def test_invalid(extra):
    with make_client() as client:
        assert client.post('/api/notify', json=payload(**extra)).status_code == 422


def test_unconfigured():
    with TestClient(create_app(token='', chat_id='')) as client:
        assert client.get('/healthz').status_code == 200
        assert client.get('/api/status').json() == {'notifications_available': False}
        assert client.post('/api/notify', json=payload()).status_code == 503


@pytest.mark.parametrize('response', [httpx.Response(401, json={'ok': False, 'description': 'secret'}), httpx.Response(200, json={'ok': False}), httpx.Response(200, text='broken')])
def test_telegram_failure(response):
    with make_client(lambda request: response) as client:
        body = payload()
        for _ in range(2):
            result = client.post('/api/notify', json=body)
            assert result.status_code == 502
            assert 'secret' not in result.text and 'test-token' not in result.text


def test_timeout():
    def timeout(request):
        raise httpx.ReadTimeout('test-token', request=request)
    with make_client(timeout) as client:
        assert client.post('/api/notify', json=payload()).status_code == 502


def test_rate_body_origin_and_expiry():
    now = [0.0]
    with make_client(clock=lambda: now[0]) as client:
        assert client.post('/api/notify', content='x' * 2049).status_code == 413
        assert client.post('/api/notify', json=payload(), headers={'Origin': 'https://other.example'}).status_code == 403
        for _ in range(10):
            assert client.post('/api/notify', json=payload()).status_code == 200
        assert client.post('/api/notify', json=payload()).status_code == 429
        now[0] += 601
        assert client.post('/api/notify', json=payload()).status_code == 200
