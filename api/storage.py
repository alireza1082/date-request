"""SQLite bootstrap for the next release; callers own the database connection."""
import json
import sqlite3
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parents[1] / 'src/data/catalog.json'
SCHEMA_VERSION = 2
BUSY_TIMEOUT_MS = 5000


def connect_database(path: str | Path) -> sqlite3.Connection:
    """Open a persistent database and initialize it before returning it to a caller."""
    connection = sqlite3.connect(str(path), timeout=BUSY_TIMEOUT_MS / 1000)
    try:
        connection.execute(f'PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}')
        connection.execute('PRAGMA foreign_keys = ON')
        connection.execute('PRAGMA journal_mode = WAL')
        initialize(connection)
        return connection
    except Exception:
        connection.close()
        raise


def initialize(connection: sqlite3.Connection) -> None:
    """Create and seed a new database atomically; never reseed an existing one."""
    connection.execute('PRAGMA foreign_keys = ON')
    try:
        connection.execute('BEGIN IMMEDIATE')
        # Read the version while holding the write lock so concurrent startup
        # cannot run the initial migration twice.
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError('Database schema is newer than this application')
        if version == SCHEMA_VERSION:
            connection.commit()
            return
        if version == 0:
            existing = connection.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%' LIMIT 1").fetchone()
            if existing:
                raise RuntimeError('Unversioned database is not empty; refusing initialization')
            catalog = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
            connection.execute('CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT NOT NULL, wheel_label TEXT NOT NULL, description TEXT NOT NULL, suggestion TEXT NOT NULL, icon TEXT NOT NULL, emoji TEXT NOT NULL, color TEXT NOT NULL, ink TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), sort_order INTEGER NOT NULL)')
            connection.execute('CREATE TABLE activity_moods (activity_id TEXT NOT NULL REFERENCES activities(id), mood_id TEXT NOT NULL, PRIMARY KEY(activity_id, mood_id))')
            connection.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            connection.execute('CREATE TABLE spins (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, display_name TEXT NOT NULL, mood_id TEXT NOT NULL, activity_id TEXT NOT NULL, activity_title TEXT NOT NULL, invitation_used INTEGER NOT NULL CHECK(invitation_used IN (0, 1)), invitation_title TEXT NOT NULL, telegram_attempted INTEGER NOT NULL DEFAULT 0 CHECK(telegram_attempted IN (0, 1)), telegram_succeeded INTEGER NOT NULL DEFAULT 0 CHECK(telegram_succeeded IN (0, 1)))')
            connection.execute('CREATE INDEX spins_created_at ON spins(created_at DESC)')
            for index, item in enumerate(catalog['activities']):
                connection.execute('INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', (item['id'], item['title'], item['wheelLabel'], item['description'], item['suggestion'], item['id'], item['emoji'], item['color'], item['ink'], index))
            for mood in catalog['moods']:
                for activity_id in mood['activities']:
                    connection.execute('INSERT INTO activity_moods VALUES (?, ?)', (activity_id, mood['id']))
            connection.execute('INSERT INTO settings VALUES (?, ?)', ('halloween_enabled', 'false'))
        connection.execute('CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, credential_version TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)')
        connection.execute('CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at)')
        connection.execute('CREATE TABLE admin_login_budget (id INTEGER PRIMARY KEY CHECK(id=1), remaining REAL NOT NULL, updated_at REAL NOT NULL)')
        connection.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def list_active_activities(connection: sqlite3.Connection) -> list[dict]:
    """Read activities and memberships in one snapshot, with deterministic ties."""
    rows = connection.execute('''
        SELECT a.id, a.title, a.wheel_label, a.description, a.suggestion,
               a.icon, a.emoji, a.color, a.ink, a.sort_order, m.mood_id
        FROM activities AS a
        LEFT JOIN activity_moods AS m ON m.activity_id = a.id
        WHERE a.enabled = 1
        ORDER BY a.sort_order, a.id, m.mood_id
    ''').fetchall()
    activities = {}
    for row in rows:
        activity_id = row[0]
        if activity_id not in activities:
            activities[activity_id] = dict(zip(
                ('id', 'title', 'wheelLabel', 'description', 'suggestion', 'icon', 'emoji', 'color', 'ink', 'sortOrder'), row[:10]))
            activities[activity_id]['moods'] = []
        if row[10] is not None:
            activities[activity_id]['moods'].append(row[10])
    return list(activities.values())
