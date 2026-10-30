# Optional Telegram notifications · 1.3.0

The browser posts a consented result to `/api/notify`. FastAPI validates it against the shared activity/mood catalog and sends a plain-text Telegram `sendMessage` to **one server-configured chat**. A success response requires Telegram HTTP 200, `ok: true`, and a message ID. It means Telegram accepted the message, not that the owner read it. No real Telegram requests are made by automated tests.

## Configure later

1. Open the official [BotFather](https://t.me/BotFather), run `/newbot`, and create a dedicated bot. Put its token into `TELEGRAM_BOT_TOKEN` in your ignored `.env`. Never put it in a frontend variable, chat, screenshot, Git, URL in a browser, or shell command argument.
2. Open your new bot in Telegram and send `/start` from the owner's private account. Bots cannot initiate a conversation with a user who has not started them.
3. Leave `TELEGRAM_CHAT_ID` empty initially. Start this project's services with `docker compose up -d --build`. Run `docker compose exec api python -m api.telegram_setup`. It reads the token from the backend environment and prints only private chat IDs, without message text or credentials. If there are several, use a fresh dedicated bot and identify your own chat. Do not use a third-party chat-ID bot.
4. Set that numeric ID as `TELEGRAM_CHAT_ID` in `.env`. Run `docker compose up -d api` to recreate the API with the new settings. Do not overwrite an existing `.env`.
5. Check `docker compose ps`, `docker compose logs --tail=100 api`, and `curl -f http://127.0.0.1:18080/api/status`. The latter should show `notifications_available: true`.
6. Create and open an invitation link yourself, spin, then deliberately choose **نتیجه رو براش بفرست 💌**. Check both the UI confirmation and the actual private Telegram chat. This is the manual live-delivery test; credentials were unavailable during development.

Telegram reference: [Bot API / sendMessage](https://core.telegram.org/bots/api#sendmessage). If you accidentally expose a token, revoke it in BotFather and replace it in the backend environment.

## Scope and protection

- Invitations are frontend URL data, not authenticated ownership claims. **Every invitation sends to the site owner's configured chat**, never an arbitrary sender's Telegram account. The UI explains this before the consent action.
- Public results are client reports, not independently verified spins. The API accepts only catalog IDs in the selected mood, an optional 52-character title, literal boolean consent, and a UUID v4 submission key. It rejects extra fields and bodies above 2 KB. It never accepts message bodies or chat destinations.
- No IP, browser, cookie, device ID, greeting, or tracking data is sent to Telegram. API and internal proxy access logging are disabled. The host's existing access logging is controlled separately by its administrator.
- One API worker uses a global 12-request bucket refilling at one request per 5 seconds, at most two outbound requests, and at most 512 duplicate records expiring after 10 minutes. No visitor identifiers are retained. These limits deliberately apply across visitors; scripted abuse can exhaust availability, but cannot forward arbitrary text or choose destinations.
- Identical accepted submission IDs return the previous acceptance without sending again. Conflicting IDs and concurrent repeats return 409. Failed delivery allows retry. A timeout can occur after Telegram accepted a message, so exactly-once delivery cannot be guaranteed. Restarting the API clears rate and duplicate state; do not run multiple workers or replicas with this in-memory design.
- Outbound HTTP has an 8-second overall bound and 7-second I/O timeout. Public errors omit Telegram responses and credentials. The endpoint has no CORS allowance and rejects other browser origins; that does not authenticate a public API.
- Missing configuration returns availability false and POST 503. A stopped API returns proxy failure; the UI disables notification gracefully. Other application features remain functional.

## Local API

From the repository root, use the venv commands in the main README. To enable live local sending, explicitly export both backend variables through your preferred local secret management before starting Uvicorn. Tests use fake tokens and `httpx.MockTransport` only:

```sh
.venv/bin/python -m pytest api -q
```

Production uses Python 3.13, one Uvicorn process, a persistent SQLite catalog, no background jobs, and no published API host port. Compose's frontend binding remains `127.0.0.1:18080:8080` (or the existing `APP_PORT` override). No VPS changes or deployment are performed by this release work.

## SQLite integration milestone (1.4.0 in progress)

This milestone adds storage startup and `GET /api/catalog` only. React and `/api/notify` still use the existing bundled catalog; notification behavior is unchanged. Admin editing and switching the frontend/notification validation to a dynamic catalog are future milestones. Do not enable catalog editing before those consumers are synchronized.

FastAPI's lifespan creates the database parent directory if missing, opens the existing storage connection, initializes/validates the schema, then closes the connection on shutdown (including failed HTTP-client startup). Startup fails if the configured path is unwritable, an unversioned database is populated, or the schema version is newer than supported. There is no replacement database or hardcoded catalog fallback. SQLite operations run in the API's async event-loop thread; do not pass the connection to worker threads.

- Local development defaults to `data/date-wheel.sqlite3` relative to the repository root. Export `DATABASE_PATH=/absolute/local/path/date-wheel.sqlite3` before Uvicorn to override it. `.env` is not automatically loaded by Uvicorn. Database files and the local `data/` directory are ignored by Git and Docker builds.
- Compose fixes `DATABASE_PATH=/app/data/date-wheel.sqlite3` and mounts the project-scoped named volume `sqlite_data` at `/app/data`. Keeping the Compose path fixed ensures a host environment variable cannot accidentally put the database outside its volume. The image creates that directory owned by UID/GID 65534, mode 0700; Docker initializes new volume ownership from it. Existing volume permissions are never silently changed. The API remains non-root with a read-only root filesystem; the mounted directory is writable for the database, WAL, and SHM files.
- Schema version 1 uses `PRAGMA user_version`, an immediate transaction for initial schema and catalog seeding, foreign-key enforcement, WAL, and a 5000ms busy timeout. Existing version-1 databases are not reseeded, so edits, disabled records, and deletions remain intact. Failed initial seeding rolls back both schema and version. The earlier foundation's settings/spins tables remain unused in this milestone.

### Catalog response

`GET /api/catalog` returns a validated JSON object with `Cache-Control: no-store`:

```json
{
  "activities": [{
    "id": "cafe", "title": "کافه‌گردی", "wheelLabel": "کافه",
    "description": "…", "suggestion": "…", "icon": "cafe", "emoji": "☕",
    "color": "#9d5862", "ink": "light", "sortOrder": 0,
    "moods": ["calm", "surprise"]
  }],
  "moods": [{"id": "calm", "label": "یه چیز آروم", "note": "دنج و بی‌عجله", "activities": ["cafe"]}]
}
```

Only enabled activities are returned, ordered by `sort_order`, then stable activity ID. Per-activity mood IDs are sorted. The top-level mood list preserves the bundled mood labels/order and contains only enabled activity IDs in catalog order. Original Persian text, IDs, colors, emoji, and memberships are seeded unchanged; `icon` initially equals the existing activity ID. Database query failure returns a generic 503, with no static replacement. This endpoint does not expose settings, spins, or Telegram credentials.

### Persistence, backups, and rollback

Keep the same Compose project name across updates so it reuses the same volume. `docker compose down` retains it; **never use `down -v`, volume prune, or volume removal for an update**. Back up before upgrades or schema changes. Do not copy only the live main database file while WAL is active.

Create a consistent SQLite backup inside the volume, then copy it out:

```sh
mkdir -p backups
# Use a fresh backup filename for every backup, e.g. backup-2026-10-30.sqlite3.
docker compose exec -T api python -c "import os, sqlite3; source = sqlite3.connect(os.environ['DATABASE_PATH']); target = sqlite3.connect('/app/data/backup-2026-10-30.sqlite3'); source.backup(target); target.close(); source.close()"
docker compose cp api:/app/data/backup-2026-10-30.sqlite3 ./backups/
```

Store the copied backup securely outside Git and verify it with `PRAGMA integrity_check`. Restore only with the API stopped, to an explicitly selected volume, preserving UID/GID 65534 and directory permissions. Preserve the original volume until restoration is verified. Do not downgrade a schema in place: an older application that rejects a newer schema requires the matching pre-upgrade backup in a separate volume. Rolling back to the frontend-only 1.3 backend leaves this volume intact but unused. This milestone does not perform any deployment or automated restoration.

Run `python -m pytest api -q` in the development venv for focused startup, persistence, catalog, migration, and existing Telegram contract tests. Each backend test receives its own temporary database through `api/conftest.py`.
