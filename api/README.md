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

Production uses Python 3.13, one Uvicorn process, no database, no background jobs, and no published API host port. Compose's frontend binding remains `127.0.0.1:18080:8080` (or the existing `APP_PORT` override). No VPS changes or deployment are performed by this release work.
