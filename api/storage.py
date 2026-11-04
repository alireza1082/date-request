"""SQLite bootstrap for the next release; callers own the database connection."""
import json
import sqlite3
from pathlib import Path

from api.seasonal_defaults import DEFAULTS

CATALOG_PATH = Path(__file__).resolve().parents[1] / 'src/data/catalog.json'
SCHEMA_VERSION = 8
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
        if version < 2:
            connection.execute('CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, credential_version TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)')
            connection.execute('CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at)')
            connection.execute('CREATE TABLE admin_login_budget (id INTEGER PRIMARY KEY CHECK(id=1), remaining REAL NOT NULL, updated_at REAL NOT NULL)')
        if version < 3:
            connection.execute('ALTER TABLE activities ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1))')
        if version < 4:
            connection.executemany('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [(key, str(value).lower() if isinstance(value, bool) else value) for key, value in DEFAULTS.items()])
        if version < 5:
            # The original spins table was intentionally created with A1. Keep
            # its rows and add only idempotency/capability and delivery fields.
            connection.execute('ALTER TABLE spins ADD COLUMN payload_hash TEXT')
            connection.execute('ALTER TABLE spins ADD COLUMN event_key_hash TEXT')
            connection.execute("ALTER TABLE spins ADD COLUMN telegram_status TEXT NOT NULL DEFAULT 'not_sent' CHECK(telegram_status IN ('not_sent', 'attempted', 'accepted', 'failed'))")
            connection.execute('ALTER TABLE spins ADD COLUMN telegram_accepted_at TEXT')
            connection.execute('CREATE UNIQUE INDEX spins_event_key_hash ON spins(event_key_hash) WHERE event_key_hash IS NOT NULL')
            connection.execute('CREATE INDEX spins_mood_created ON spins(mood_id, created_at DESC)')
            connection.execute('CREATE INDEX spins_activity_created ON spins(activity_id, created_at DESC)')
            connection.execute('CREATE INDEX spins_invitation_created ON spins(invitation_used, created_at DESC)')
        if version < 6:
            connection.execute('''CREATE TABLE telegram_diagnostics (
                id INTEGER PRIMARY KEY CHECK(id=1),
                last_success_at TEXT,
                last_failure_at TEXT,
                last_error TEXT,
                success_count INTEGER NOT NULL DEFAULT 0 CHECK(success_count >= 0),
                failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
                last_test_at TEXT,
                bot_validated_at TEXT,
                validation_error TEXT
            )''')
            connection.execute('INSERT INTO telegram_diagnostics (id) VALUES (1)')
        if version < 7:
            connection.execute("INSERT OR IGNORE INTO settings VALUES ('party_enabled', 'false')")
            additions = (
                ('horse-riding', 'اسب‌سواری', 'اسب‌سواری', 'یک تجربهٔ دونفره در مرکز معتبر سوارکاری، با مربی و تجهیزات ایمنی.', 'مرکز معتبر رزرو کنین؛ کلاه ایمنی بپوشین و طبق راهنمایی مربی پیش برین.', 'walk', '🐎', '#5d765f'),
                ('escape-room', 'اتاق فرار', 'اتاق فرار', 'یک معمای مشترک؛ سرنخ‌ها رو کنار هم بذاریم.', 'یک سناریوی مناسب دو نفر انتخاب کنین و درجهٔ سختی رو از قبل بپرسین.', 'museum', '🔎', '#925b58'),
                ('laser-tag', 'لیزرتگ', 'لیزرتگ', 'یک رقابت تفریحی در مجموعهٔ مجاز لیزرتگ.', 'قوانین مجموعه رو مرور کنین و یک دور دوستانه با تجهیزات استاندارد بازی کنین.', 'bowling', '✨', '#836943'),
            )
            for activity_id, title, label, description, suggestion, icon, emoji, color in additions:
                if connection.execute('SELECT 1 FROM activities WHERE id=?', (activity_id,)).fetchone():
                    continue
                count = connection.execute('SELECT count(*) FROM activities WHERE archived=0').fetchone()[0]
                active = connection.execute("SELECT count(*) FROM activities a JOIN activity_moods m ON a.id=m.activity_id WHERE a.enabled=1 AND a.archived=0 AND m.mood_id='outdoor'").fetchone()[0]
                order = connection.execute('SELECT coalesce(max(sort_order), -1)+1 FROM activities').fetchone()[0]
                connection.execute('INSERT INTO activities (id,title,wheel_label,description,suggestion,icon,emoji,color,ink,enabled,sort_order,archived) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                    (activity_id,title,label,description,suggestion,icon,emoji,color,'light',int(count < 40 and active < 10), min(order,10000),int(count >= 40)))
                connection.execute("INSERT INTO activity_moods VALUES (?, 'outdoor')", (activity_id,))
        if version < 8:
            connection.execute("INSERT OR IGNORE INTO settings VALUES ('mode_version', '0')")
            connection.execute("INSERT OR IGNORE INTO settings VALUES ('party_selection_mode', 'random')")
            connection.execute("INSERT OR IGNORE INTO settings VALUES ('party_fixed_scenario_id', '')")
            connection.execute('''CREATE TABLE party_media (
                id TEXT PRIMARY KEY,
                content BLOB NOT NULL,
                created_at TEXT NOT NULL
            )''')
            connection.execute('''CREATE TABLE party_scenarios (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                headline TEXT NOT NULL,
                description TEXT NOT NULL,
                alt TEXT NOT NULL,
                artwork_key TEXT NOT NULL,
                media_id TEXT REFERENCES party_media(id) ON DELETE SET NULL,
                enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
                sort_order INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )''')
            connection.execute('CREATE INDEX party_scenarios_public_order ON party_scenarios(enabled, archived, sort_order, id)')
            connection.execute('''CREATE TABLE party_scenario_steps (
                scenario_id TEXT NOT NULL REFERENCES party_scenarios(id) ON DELETE CASCADE,
                step_order INTEGER NOT NULL,
                text TEXT NOT NULL,
                PRIMARY KEY(scenario_id, step_order)
            )''')
            from api.party_defaults import PARTY_DEFAULTS
            for index, scenario in enumerate(PARTY_DEFAULTS):
                connection.execute('''INSERT OR IGNORE INTO party_scenarios
                    (id,title,headline,description,alt,artwork_key,enabled,sort_order,archived,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,1,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)''',
                    (scenario['id'], scenario['title'], scenario['headline'], scenario['description'], scenario['alt'], scenario['artwork_key'], index))
                connection.executemany('INSERT OR IGNORE INTO party_scenario_steps VALUES (?,?,?)',
                    [(scenario['id'], step_index, step) for step_index, step in enumerate(scenario['steps'])])
        connection.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def list_activities(connection: sqlite3.Connection, *, include_inactive: bool = False) -> list[dict]:
    """Read activities and memberships in one snapshot, with deterministic ties."""
    condition = '' if include_inactive else 'WHERE a.enabled = 1 AND a.archived = 0'
    rows = connection.execute(f'''
        SELECT a.id, a.title, a.wheel_label, a.description, a.suggestion,
               a.icon, a.emoji, a.color, a.ink, a.sort_order, m.mood_id, a.enabled, a.archived
        FROM activities AS a
        LEFT JOIN activity_moods AS m ON m.activity_id = a.id
        {condition}
        ORDER BY a.sort_order, a.id, m.mood_id
    ''').fetchall()
    activities = {}
    for row in rows:
        activity_id = row[0]
        if activity_id not in activities:
            activities[activity_id] = dict(zip(
                ('id', 'title', 'wheelLabel', 'description', 'suggestion', 'icon', 'emoji', 'color', 'ink', 'sortOrder'), row[:10]))
            activities[activity_id]['moods'] = []
            if include_inactive:
                activities[activity_id]['enabled'] = bool(row[11])
                activities[activity_id]['archived'] = bool(row[12])
        if row[10] is not None:
            activities[activity_id]['moods'].append(row[10])
    return list(activities.values())


def list_active_activities(connection: sqlite3.Connection) -> list[dict]:
    return list_activities(connection)


def notification_activity(connection: sqlite3.Connection, activity_id: str, mood: str):
    return connection.execute('''
        SELECT a.title, a.suggestion FROM activities AS a
        JOIN activity_moods AS m ON m.activity_id = a.id
        WHERE a.id = ? AND m.mood_id = ? AND a.enabled = 1 AND a.archived = 0
    ''', (activity_id, mood)).fetchone()
