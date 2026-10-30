# Optional Telegram notifications · 1.3.0

The browser posts a consented result to `/api/notify`. FastAPI validates it against the active SQLite activity/mood catalog and sends a plain-text Telegram `sendMessage` to **one server-configured chat**. A success response requires Telegram HTTP 200, `ok: true`, and a message ID. It means Telegram accepted the message, not that the owner read it. No real Telegram requests are made by automated tests.

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
- For activities still selectable in the requested mood, identical accepted submission IDs return the previous acceptance without sending again. Conflicting IDs and concurrent repeats return 409. Failed delivery allows retry. A timeout can occur after Telegram accepted a message, so exactly-once delivery cannot be guaranteed. Restarting the API clears rate and duplicate state; do not run multiple workers or replicas with this in-memory design.
- Outbound HTTP has an 8-second overall bound and 7-second I/O timeout. Public errors omit Telegram responses and credentials. The endpoint has no CORS allowance and rejects other browser origins; that does not authenticate a public API.
- Missing configuration returns availability false and POST 503. A stopped API returns proxy failure; the UI disables notification gracefully. Other application features remain functional.

## Local API

From the repository root, use the venv commands in the main README. To enable live local sending, explicitly export both backend variables through your preferred local secret management before starting Uvicorn. Tests use fake tokens and `httpx.MockTransport` only:

```sh
.venv/bin/python -m pytest api -q
```

Production uses Python 3.13, one Uvicorn process, a persistent SQLite catalog, no background jobs, and no published API host port. Compose's frontend binding remains `127.0.0.1:18080:8080` (or the existing `APP_PORT` override). No VPS changes or deployment are performed by this release work.

## SQLite integration milestone (1.4.0 in progress)

A1 added storage startup and `GET /api/catalog`. A3 below adds authenticated editing and moves `/api/notify` validation/message copy to the persistent catalog. React still uses the bundled catalog and its live-data integration remains a later milestone; stale frontend selections that are no longer active in SQLite are rejected with 422 rather than substituted.

FastAPI's lifespan creates the database parent directory if missing, opens the existing storage connection, initializes/validates the schema, then closes the connection on shutdown (including failed HTTP-client startup). Startup fails if the configured path is unwritable, an unversioned database is populated, or the schema version is newer than supported. There is no replacement database or hardcoded catalog fallback. SQLite operations run in the API's async event-loop thread; do not pass the connection to worker threads.

- Local development defaults to `data/date-wheel.sqlite3` relative to the repository root. Export `DATABASE_PATH=/absolute/local/path/date-wheel.sqlite3` before Uvicorn to override it. `.env` is not automatically loaded by Uvicorn. Database files and the local `data/` directory are ignored by Git and Docker builds.
- Compose fixes `DATABASE_PATH=/app/data/date-wheel.sqlite3` and mounts the project-scoped named volume `sqlite_data` at `/app/data`. Keeping the Compose path fixed ensures a host environment variable cannot accidentally put the database outside its volume. The image creates that directory owned by UID/GID 65534, mode 0700; Docker initializes new volume ownership from it. Existing volume permissions are never silently changed. The API remains non-root with a read-only root filesystem; the mounted directory is writable for the database, WAL, and SHM files.
- Schema version 1 uses `PRAGMA user_version`, an immediate transaction for initial schema and catalog seeding, foreign-key enforcement, WAL, and a 5000ms busy timeout. Existing version-1 databases are not reseeded, so edits, disabled records, and deletions remain intact. Failed initial seeding rolls back both schema and version. The existing settings table is used by A4.1; the earlier foundation's spins table remains unused until history is implemented.

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

## A2: single-admin authentication (1.4.0 in development)

Authentication is disabled with generic HTTP 503 responses when configuration is missing or invalid; public wheel/catalog/Telegram endpoints continue to work. A2 provides no admin UI; A3 adds the protected activity APIs documented below. Credentials are read at API startup and reach only the API container.

Configure these ignored `.env` values for Compose:

- `ADMIN_PASSWORD`: 14–128 characters, at least eight distinct characters, and at least three of lowercase/uppercase/digits/symbols. Alternatively use a passphrase of at least 20 characters and four words (same distinct-character minimum). Maximum UTF-8 length is 512 bytes. There is no default password.
- `ADMIN_SESSION_SECRET`: a stable, randomly generated URL-safe secret, 43–256 characters with at least 16 distinct characters. Generate one with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` in your private terminal and store it in `.env` or your normal secret manager. Do not regenerate it during deployments. Never put it in Vite variables, Git, logs, or chat.
- `ADMIN_ORIGIN`: the exact external HTTPS origin, e.g. `https://date.benjiro.ir`, without a trailing slash or path. Origin validation uses this configured value, not Host or arbitrary forwarded headers. TLS must be enforced by the existing host Nginx; the internal API remains unexposed. Do not enable HTTP access to the production admin origin.

Restart/recreate only the API after changing these values. The password is verified with scrypt (`N=32768, r=8, p=3`, approximately 32 MiB working memory), a secret-derived domain-separated salt, and constant-time digest comparison. Only the derived key remains in the auth object; the deployment environment necessarily retains the configured password. Verification runs in a worker thread with at most one KDF running per API process. No plaintext password is stored in SQLite or included in response/validation errors.

### SPA login and CSRF flow

All requests below are same-origin, with cookies included. There are no redirects or CORS grants.

1. `GET /api/admin/auth/csrf` obtains `{"csrf_token":"…"}` and a short-lived, signed, HttpOnly login-challenge cookie. GET may omit Origin; if supplied it must match. Cross-site Fetch Metadata is rejected. The response is unreadable to other origins under the same-origin policy.
2. `POST /api/admin/auth/login` sends JSON `{"password":"…"}`, the exact `Origin`, and `X-CSRF-Token` from step 1. The challenge cookie and header must match and be less than five minutes old. Login CSRF verification also applies to JSON requests. Invalid credentials return generic 401, invalid/missing CSRF or Origin 403, schema errors 422, oversized bodies 413, and throttling 429 with `Retry-After: 60`.
3. Success returns only `{"authenticated":true}` and sets the session cookie. It deletes the login-challenge cookie and always generates a new session token. To log in again while already authenticated, log out first.
4. `GET /api/admin/auth/me` returns `{"authenticated":true}` for a valid session; absent, expired, revoked, or tampered sessions return generic 401. It never returns the session ID, hashes, credentials, or expiry details.
5. After login, call `GET /api/admin/auth/csrf` again to obtain the **session-bound** CSRF token. Keep it in SPA memory. Send it as `X-CSRF-Token`, plus the configured `Origin`, on every authenticated mutation.
6. `POST /api/admin/auth/logout` requires that session-bound token and Origin. It deletes the server-side session and clears the cookie, returning `{"authenticated":false}`. A copied old cookie no longer authenticates. Repeated logout without a session returns 401.

All admin responses have `Cache-Control: no-store` and `Pragma: no-cache`. Session tokens are 32 random bytes and are sent only through HttpOnly cookies, never JSON. Production uses host-only `__Host-datewheel-admin` and `__Host-datewheel-login` cookies: Secure, SameSite=Strict, Path=/, no Domain. The browser cannot expose the session cookie to JavaScript. Session CSRF tokens are separate, domain-separated HMAC values bound to the session hash and server secret. Login challenge cookies are signed; simply copying an arbitrary cookie value into the header cannot pass validation.

### Future protected routes

Use `Depends(require_admin)` imported from `api.auth` for read-only routes, and `Depends(require_admin_mutation)` for state-changing routes. Both are async dependencies; SQLite stays on the API event-loop thread. The latter validates the session, exact Origin, and session-bound CSRF header. A middleware guard also enforces authentication/CSRF for unsafe methods under `/api/admin/`, except login which has its own challenge protection. Future GET routes still need the read dependency. Admin request bodies are currently limited to 2 KB, matching internal Nginx; any future size change must update both limits deliberately. Never mutate state in a GET endpoint.

### Sessions, migration, and throttling

Schema **2** adds only `admin_sessions` (HMAC of token, credential version, server timestamps) and a singleton `admin_login_budget` table plus an expiry index. The version-1-to-2 migration is atomic and never reseeds or modifies activity/settings/history rows. A new empty database is initialized with the original catalog before adding these auth tables. Unsupported newer schemas still fail startup. Back up before upgrading: the earlier A1 binary rejects schema 2, so rollback needs the matching backup in a separate volume, never an in-place downgrade.

Sessions expire absolutely after eight hours. Expired sessions are removed during validation/login; state is bounded to 32 active sessions, revoking the oldest as needed. Restart/recreation preserves sessions when the SQLite volume, password, and secret stay unchanged. Changing either password or secret invalidates prior sessions. Successful login replaces any presented old session. The database contains neither raw session tokens nor CSRF tokens. Revocation is immediate on logout.

The global login bucket allows five initial attempts and refills one attempt per minute. Every login POST counts, including malformed or CSRF-rejected attempts, to bound work. The single SQLite row survives restarts and does not grow with clients. X-Forwarded-For and visitor identifiers are not used or retained. There is no permanent lockout, but sustained public abuse can consume the shared budget; an owner must wait for a refill. Do not scale this application to multiple API workers without reviewing the existing Telegram limits and KDF concurrency guard.

### Local development and troubleshooting

Direct local Uvicorn may use `ADMIN_ORIGIN=http://127.0.0.1:4173` plus the explicit **local-process-only** variable `ADMIN_ALLOW_INSECURE_LOCAL=true`. It permits non-Secure cookies only for localhost/127.0.0.1/::1 origins and uses distinct local cookie names. Compose deliberately does not forward this override. Otherwise HTTPS is required even in development. `.env` is not automatically loaded by Uvicorn; export the variables through your local secret manager. Never use the insecure override on a deployed server.

- 503: check all three settings privately, password/secret strength, origin syntax, and restart the API. Public status does not reveal admin configuration details.
- 401: the session may have expired, been logged out, or become invalid after credential rotation. Obtain a fresh login challenge and log in.
- 403: obtain the correct CSRF token for the current login/session and send the exact configured Origin. Ensure the browser uses the public HTTPS hostname and sends cookies. A login CSRF token cannot be used for logout or another session.
- 429: wait at least the indicated interval. Restarting does not reset the SQLite login budget.
- If cookies are missing, inspect HTTPS and host/path matching in browser tools. Do not print or copy cookie values into logs. Secure cookies will not work over plain HTTP.

Focused tests use temporary databases, fake credentials and mocked Telegram; no real Telegram messages are sent. Design references: [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [Python scrypt](https://docs.python.org/3/library/hashlib.html#hashlib.scrypt).

## A3: persistent activity management (1.4.0 in development)

All routes below are under `/api/admin`. Reads use `require_admin`; writes use `require_admin_mutation` plus the existing middleware protection. Log in using A2, obtain the session-bound CSRF token, and send both `X-CSRF-Token` and the exact configured `Origin` on writes. The 2 KB request limit remains in effect. Responses are never cached. A3 introduced no admin UI, history, campaign settings, or new release; A4 work in progress is documented below.

| Method | Route | Response |
| --- | --- | --- |
| GET | `/api/admin/activities` | `{"activities":[...]}` including disabled and archived records |
| POST | `/api/admin/activities` | 201 with created activity |
| GET | `/api/admin/activities/{id}` | Activity object, including disabled/archived flags |
| PATCH | `/api/admin/activities/{id}` | Updated activity object |
| POST | `/api/admin/activities/reorder` | `{"activities":[...]}` after transactional reorder |
| DELETE | `/api/admin/activities/{id}` | 204; archive and disable, preserving ID and memberships |
| GET | `/api/admin/icons` | `{"icons":[{"id":"cafe","label":"فنجان قهوه","category":"خوراکی و کافه"}, ...]}` |

### Activity requests and responses

Example create request (all text is plain UTF-8, not HTML):

```json
{
  "id": "quiet-cafe",
  "title": "یک کافهٔ دنج",
  "wheelLabel": "کافهٔ دنج",
  "description": "یه میز کنار پنجره پیدا کنیم.",
  "suggestion": "هر کدوم یه نوشیدنی تازه امتحان کنین.",
  "icon": "cafe",
  "color": "#9d5862",
  "moods": ["calm"],
  "enabled": true
}
```

ID is 1–32 lowercase ASCII letters/digits with optional single hyphens between groups, starting with a letter. IDs are immutable and reserved even after archival; duplicate creation returns 409. Title is 1–80 characters, `wheelLabel` 1–14, description 1–240, and suggestion 1–160. Whitespace-only, markup delimiters, control characters, bidi overrides and invalid UTF-8 are rejected. Input is trimmed; Persian letters, normal punctuation and ZWNJ are preserved. Unknown fields are rejected, including client-supplied `emoji` and `ink`.

`moods` must be a nonempty unique subset of `surprise`, `calm`, `outdoor`. Surprise membership is explicit, not automatically added to every new activity. `enabled` defaults to true and must be a JSON boolean. Optional `sortOrder` is an integer 0–10000; omission/null on creation appends after the highest non-archived order. If append would exceed 10000, reorder first. PATCH accepts any nonempty subset of editable fields, `sortOrder`, and `archived`, but never `id` or null values. The complete merged record is validated before writing.

Admin activity responses contain the A1 fields (`id`, `title`, `wheelLabel`, `description`, `suggestion`, `icon`, `emoji`, `color`, `ink`, `sortOrder`, `moods`) plus `enabled` and `archived` booleans. Missing records return 404. Invalid schemas/fields return generic 422, storage/configuration conflicts 409, and unavailable storage 503. Mutations are parameterized SQL inside `BEGIN IMMEDIATE`; failures roll back the activity and all memberships together.

### Local icons and color tokens

The approved icon IDs are **cafe, cinema, ice-cream, dinner, breakfast, walk, picnic, bookshop, museum, bowling**. These are the ten actual keys in the existing bundled `artworkById`, not invented library names. The icon endpoint supplies Persian labels/categories for a future picker. Emoji is derived server-side from that icon. No uploaded SVG, arbitrary HTML, URL, or remote icon source is accepted. A regression test compares the whitelist to the actual existing artwork registry.

Color tokens retain the existing hex representation. Allowed values are `#9d5862`, `#6a6984`, `#e3a280`, `#e0ac73`, `#dfbd83`, `#5d765f`, `#577571`, `#765f7c`, `#925b58`, `#836943`. Uppercase hex is normalized to lowercase. `ink` is derived from the original palette's light/dark setting to preserve label contrast; clients cannot override it. The frontend still resolves current postcard artwork using its static activity IDs; using persisted `icon` for new activity IDs belongs to the later frontend integration.

### Ordering, availability, and archival

Reads sort by `sort_order`, then stable ID; duplicate order numbers are deterministic. Reorder takes `{"ids":[...]}` containing **every non-archived ID exactly once**, including disabled drafts, in the desired order. It normalizes those positions to 0..N-1. Missing, stale, archived, unknown or duplicate IDs reject the whole operation; archived rows retain their previous order. At most 40 non-archived records are allowed so the complete ID list fits the existing 2 KB limit. Archiving a draft can free a slot without deleting its ID.

Every mutation checks the resulting configuration before commit: **each of the three moods must retain 2–10 enabled, non-archived activities**. Two matches the wheel engine's minimum; ten limits label density to the existing visual design. Creating/enabling an eleventh visible option, removing a second-to-last option, or removing its last necessary membership returns 409 and rolls back. Create a disabled draft or replace membership/availability first when a mood is full. This policy applies to the persisted catalog; it does not substitute bundled activities.

DELETE is idempotent for an existing archived record. It sets `archived=true`, `enabled=false`; rows and memberships remain stored and never reseed on restart. PATCH `{"archived":false}` restores a disabled draft; add `"enabled":true` in that same request if desired and the constraints permit it. An archived activity cannot be enabled without restoring it. Lists include archived records so future UI can restore them.

### Live public catalog and Telegram

`GET /api/catalog` retains the exact A1 response schema and reads SQLite on every call. Only enabled/non-archived activities appear; top-level mood lists reflect their current memberships and order. Admin-only flags never appear publicly. No restart or frontend build is needed for **API** changes. A database read error or an externally corrupted wheel configuration returns the existing generic 503, never a hardcoded fallback. Direct database writes bypass the API safeguards and are unsupported outside controlled backup/repair procedures.

`POST /api/notify` retains its request schema, explicit consent requirement, response on acceptance, fixed server-side destination, timeouts and existing rate/duplicate limits. Activity existence, enabled/archive state and requested mood are now checked against SQLite. Message title/suggestion come from the selected stored row, so new admin-created activity IDs work without an API restart. Invalid, disabled, archived or mismatched selections return generic 422; database read failure returns generic 503. Automated tests mock Telegram and never send real messages.

**Live frontend synchronization is not complete in A3.** The existing React wheel, labels and postcard components still load bundled content. A later milestone must consume `/api/catalog` and resolve illustrations by the approved `icon` field. Editing a visible option now may cause an old static client's selection to be rejected by notification validation. There is no silent fallback to stale static content in the API.

### Schema 3 and validation

The transaction from schema 2 to **3** adds only `activities.archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))`. Existing activity IDs, copy, ordering, memberships, settings and sessions are preserved. Empty databases still seed once, then apply migrations; archived rows never cause reseeding. Older binaries reject schema 3: use the existing backup/rollback procedure and a matching pre-upgrade backup in a separate volume, never downgrade in place. The API Dockerfile only adds the required Python modules; Nginx, Compose ports, persistent volume and resource limits are unchanged.

Run `.venv/bin/python -m pytest api -q` from the repository root. Focused coverage includes auth/CSRF, CRUD, archive/restore, ordering, palette/icon validation, minimum/maximum counts, transactional rollback, persisted edits, migration preservation and mocked Telegram compatibility. No frontend visual suite is needed for this backend-only milestone.

## A4.1: persistent seasonal settings (1.4.0 in development)

`GET /api/settings` returns the public seasonal values. `GET /api/admin/settings` requires the existing admin session, and `PATCH /api/admin/settings` additionally requires the existing Origin and session-bound CSRF token. PATCH accepts a nonempty subset of `halloween_enabled`, `halloween_title`, `halloween_subtitle`, `halloween_cta`, and `halloween_note`; text is length-limited and treated as plain text. Values are written transactionally to the existing SQLite `settings` table. Schema 4 inserts missing defaults transactionally with `INSERT OR IGNORE`; existing administrator values are preserved, and Halloween is disabled by default. Missing or invalid persisted values return 503 rather than being silently replaced. Updates are immediately visible from the public endpoint without a rebuild. Responses use the existing `no-store` policy.

The version-3-to-4 migration preserves activities, memberships, archived flags, sessions and existing settings; the following A4.2 migration extends it to schema 5. Older binaries reject newer schemas. Back up before upgrading and restore an appropriate pre-upgrade backup to a separate volume when rolling back.

## A4.2: consented spin history (schema 5)

`POST /api/history` records one **client-reported** result only after explicit visitor consent. The request must include a UUID v4 `event_id`, a 32-byte URL-safe `event_key`, literal `consent: true`, an existing (including archived) activity ID, a short title snapshot, one known mood ID, `invitation_used`, and an optional display name/pseudonym and invitation title. The API creates the timestamp in UTC. Unknown activity IDs are rejected; existing IDs remain reserved after archive so a wheel snapshot already in progress can finish. The title and mood are submitted snapshots and are not proof that a spin occurred. No IP, user agent, browser/device identifier or location is recorded. The public response contains only recording status and timestamp, never the visitor's name.

The event ID, payload digest and hash of the opaque event key provide safe retries. Reusing an ID with a different payload or key returns 409. Bodies are capped at 2 KB, display names at 32 characters, titles at 80/52, and a process-global token bucket permits a burst of 30 then refills one event per 10 seconds. There are no per-visitor identifiers; these coarse limits are shared by visitors and reset on API restart. The table is additionally capped at 50,000 events; submissions pause with 503 at capacity until retention cleanup or an administrator clears history. Run one API process: these in-memory abuse limits are not shared between workers/replicas.

`HISTORY_RETENTION_DAYS` defaults to 90 and accepts 1–365. At startup and hourly, a bounded sweep removes at most 500 expired rows; later sweeps continue cleanup if more than one batch has expired. Historical title snapshots survive activity edits and archiving. The same SQLite `spins` table is used; schema 5 adds nullable payload/capability digests, a constrained Telegram status, acceptance timestamp and query indexes without rewriting existing rows. Migration is transactional. Unsupported newer schemas fail startup.

Admin reads require the existing admin session. Examples:

- `GET /api/admin/history?page_size=30&offset=0&mood_id=calm&date_from=2026-10-01&date_to=2026-10-31&invitation_used=true&telegram_status=not_sent`
- `GET /api/admin/history/stats` — recorded events only; `today_spins` and `last_7_days` use UTC.
- `DELETE /api/admin/history` with JSON `{"confirmation":"CLEAR_HISTORY"}` — requires the existing exact Origin and session-bound `X-CSRF-Token`; it deletes only spin events.

History responses explicitly mark `reported_events: true`; statistics are not fraud-proof and include only results visitors chose to record. Before integrating this endpoint, the frontend must explain that an optional display name and result may be viewed by the site owner, provide a real decline option, and skip the request entirely after decline. A history event never triggers Telegram. The separate result-send action remains explicit. A4.3 will use the stored capability digest for trusted notification correlation.
