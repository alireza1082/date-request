# چرخِ قرار · Date Wheel

A tiny Persian interactive surprise for choosing a date together. The React application supports static hosting. An optional small FastAPI service sends consented results to one configured Telegram chat; its API also maintains a persistent SQLite activity catalog. There is no account system.

**Version:** 1.3.0

## Design notes

The visual direction treats the app as a small illustrated postcard: warm paper, pomegranate ink, quiet brass details, and locally drawn activity artwork. Three small mood choices reshape the wheel without changing its unbiased selection engine. A personalized invitation can carry a short title, greeting, and mood in a compact URL fragment; a recipient sees the greeting before the wheel. Result cards can be saved as a 1080 × 1350 PNG or shared as an image when the browser supports file sharing.

The design research included the [Dribbble Lucky Wheel presentation](https://dribbble.com/shots/18591372-The-Lucky-Wheel), [NN/g's guidance on purposeful motion](https://www.nngroup.com/articles/animation-purpose-ux/), and [web.dev's animation performance guide](https://web.dev/articles/animations-guide). These informed a clear wheel-first hierarchy, short state feedback, and transform/opacity-led motion. The provided Behance page returned 403 and Awwwards timed out in this environment, so they were not used for visual analysis. The Persian postcard composition and illustrations are original.

## Stack

- React 19 and TypeScript strict mode
- Vite for development and static production assets
- SVG wheel with a pure, independently tested geometry and selection engine
- Vazirmatn Variable bundled locally through Fontsource
- Canvas and local SVG artwork for shareable result postcards
- Vitest for unit tests and Playwright for browser tests
- Native HTML dialogs, Web Share API, and clipboard fallback

## Requirements

- Node.js 20.19+ or 22.12+
- pnpm 12+
- Optional local API: Python 3.11+ (the production image uses Python 3.13)

## Install and run

```sh
pnpm install
pnpm dev
```

Vite serves the app at `http://127.0.0.1:4173`.

## Build and checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

The browser suite verifies the visible segment under the pointer, rapid-click protection, repeat spins, mood changes, invitations, safe text rendering, PNG download, export failure fallback, reduced motion, clipboard sharing, and viewport widths from 320px to 1440px. It runs in Chromium, desktop WebKit, and an iPhone-sized WebKit emulation.

## Architecture

```text
src/
  app/                         Page composition and focus restoration
  data/
    activities.ts              Persian activity copy and suggestions
    moods.ts                   Mood labels and curated activity pools
  features/
    invitations/               URL codec, greeting, composer, sharing
    results/                    Postcard preview, SVG artwork, canvas export
    wheel/
      components/               SVG wheel and tactile controls
      engine/                   Secure selection and angle calculations
      hooks/                     Spin animation lifecycle
  styles/                       Tokens, responsive layout, and motion
e2e/                             Playwright interaction and viewport tests
```

`wheel-engine.ts` owns segment geometry, unbiased selection with `crypto.getRandomValues`, rotation normalization, and final pointer alignment. `useWheelSpin` selects one index and passes it through animation to the result state; the wheel and result use that same selection. `moods.ts` selects a local pool before the spin, so each visible segment remains equally likely. `invitation-codec.ts` validates a versioned payload with a 52-character title, 100-character greeting, and 900-character URL limit. Imported text is rendered safely as text. Postcard PNGs are composed locally after the bundled Persian font loads and use no remote assets.

## Activities and moods

Edit `src/data/catalog.json`. Keep each ID unique and `wheelLabel` concise; the surprise wheel has ten equal-size segments, while the calm and outdoor pools have five each. Add every activity's illustration to `src/features/results/activity-artwork-data.ts` and its mood membership to the same catalog. Each activity includes a result title, description, short suggestion, share emoji, segment color, and label contrast setting. Tests check label contrast and segment alignment after pool changes.

## Invitations and privacy

Use **یه دعوت کوچولو** to add an optional title and greeting, pick a mood, and create a shareable link. The configuration lives in the URL fragment, so the web server does not receive it. Anyone with the link can read its text; avoid names and private details. Invitation content is not saved to local storage or a backend. Malformed or oversized links fall back to the default wheel.

## Result postcards

The result sheet includes a **ذخیره کارت** action for a crisp PNG and **اشتراک‌گذاری**. Browsers that support sharing image files send the postcard; other browsers fall back to the existing Persian text share and clipboard behavior. If image generation fails, sharing still attempts the text message.

## Deployment

Docker Compose is the recommended deployment. It binds the unprivileged Nginx container to `127.0.0.1:18080`; add the documented location snippet to an existing VPS Nginx HTTPS virtual host. Start with [deploy/README.md](deploy/README.md).

For direct static hosting, run `pnpm install --frozen-lockfile` and `pnpm build`, then serve `dist/` using [deploy/nginx-static.conf.example](deploy/nginx-static.conf.example). No backend or runtime API is required. The bundled font makes no external font request.

## Version 1.3.0

Normal visits open a paper invitation intro; personalized links retain their greeting and skip the extra intro. Wheel labels use centered, continuous Persian SVG text without negative letter spacing, outlines, or glyph shadows. The selection engine is unchanged.

Activity copy, mood membership, and Telegram allowlists share `src/data/catalog.json`. Keep that catalog authoritative when editing options. Invitation results include an explicit optional Telegram action; it sends only activity ID, mood, optional title, consent, and a short-lived idempotency key. It never sends the greeting or visitor metadata. **All invitations use the site owner's fixed Telegram destination**, including invitations created by other visitors; this is stated next to the action.

Run the optional API from the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r api/requirements-dev.txt
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000 --no-access-log
# separate terminal
pnpm dev
# API tests, with mocked Telegram only
.venv/bin/python -m pytest api -q
```

Vite proxies `/api` to localhost:8000. No credentials are needed for development; notification availability is false until both backend variables are configured. If the API is offline, the existing wheel, PNG, and sharing features still work. See [Telegram setup and operations](api/README.md). No secrets belong in `VITE_` variables.

### Backend SQLite milestone (1.4.0 in progress)

The API now initializes a persistent SQLite catalog during lifespan startup and exposes read-only `GET /api/catalog`. Compose stores it in a named volume; local Uvicorn defaults to ignored `data/date-wheel.sqlite3`, configurable through `DATABASE_PATH`. The existing frontend and `/api/notify` contract are unchanged. See [storage, response, backup, and rollback notes](api/README.md#sqlite-integration-milestone-140-in-progress). This milestone does not release 1.4.0 or implement admin features.
