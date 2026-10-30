"""Every backend test gets a separate database, including legacy API tests."""
import pytest


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'api.sqlite3'))

    for name in ('ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET', 'ADMIN_ORIGIN', 'ADMIN_ALLOW_INSECURE_LOCAL'):
        monkeypatch.delenv(name, raising=False)
