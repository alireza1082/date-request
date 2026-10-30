# چرخِ قرار · Date Wheel

A tiny Persian interactive surprise for choosing a date together. The frontend ships as static assets, while the lightweight FastAPI service provides the live activity catalog, seasonal settings, administration, consented history, and optional Telegram delivery. There is no visitor account system.

**Version:** 1.4.0

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
    catalog-api.ts             Runtime catalog contract and validation
    catalog.json               Initial SQLite seed data and palette
    moods.ts                   Stable mood IDs and invitation validation
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

`wheel-engine.ts` owns segment geometry, unbiased selection with `crypto.getRandomValues`, rotation normalization, and final pointer alignment. `useWheelSpin` selects one index and passes it through animation to the result state; the wheel and result use that same selection. The public app validates the runtime `/api/catalog` response and refreshes it before a spin; the selected activity array is frozen for that spin and its result card. `invitation-codec.ts` validates a versioned payload with a 52-character title, 100-character greeting, and 900-character URL limit. Imported text is rendered safely as text. Postcard PNGs are composed locally after the bundled Persian font loads and use no remote assets.

## Activities and moods

Manage live activities from `/admin` using the approved icon and color catalogs. Changes persist in SQLite and apply to the next public wheel load/spin without a frontend rebuild. `src/data/catalog.json` is only the initial database seed and shared palette reference; do not edit it to manage production activities. Every approved icon has a local illustration used in result cards and PNG postcards. The API enforces 2–10 active choices per mood.

## Invitations and privacy

Use **یه دعوت کوچولو** to add an optional title and greeting, pick a mood, and create a shareable link. The configuration lives in the URL fragment, so the web server does not receive it. Anyone with the link can read its text; avoid names and private details. Invitation content is not saved to local storage or a backend. Malformed or oversized links fall back to the default wheel.

Before entering the wheel, visitors can add a short display name or continue without one. Spin history is a separate, unchecked opt-in. If enabled, the selected result and optional name are saved for the site owner to view; if declined, the app sends no history request and still works normally. Results are client-reported, retained for 90 days by default, and are not independently verified. Telegram sending is a separate deliberate action and does not require history consent. Names and history choices are kept only in page memory and are not put in URLs or browser storage.

After this entry step the app fetches the current seasonal settings from `/api/settings`. If the owner has enabled Halloween, a short illustrated invitation appears with the saved Persian title, message, note, and CTA. The same invitation card is used in the admin preview. If settings cannot be reached, the visitor can retry or explicitly continue without the optional seasonal screen.

## Result postcards

The result sheet includes a **ذخیره کارت** action for a crisp PNG and **اشتراک‌گذاری**. Browsers that support sharing image files send the postcard; other browsers fall back to the existing Persian text share and clipboard behavior. If image generation fails, sharing still attempts the text message.

## Deployment

Docker Compose is the recommended deployment. It binds the unprivileged Nginx container to `127.0.0.1:18080`; add the documented location snippet to an existing VPS Nginx HTTPS virtual host. Start with [deploy/README.md](deploy/README.md).

For direct static asset hosting, run `pnpm install --frozen-lockfile` and `pnpm build`, then serve `dist/` using [deploy/nginx-static.conf.example](deploy/nginx-static.conf.example). The React app still requires the FastAPI service at the same-origin `/api/` path for its live catalog and settings; the example proxies that path to a localhost-only API. The bundled font makes no external font request.

## Version 1.4.0

Normal visits open a paper invitation intro; personalized links retain their greeting and skip the extra intro. Wheel labels use centered, continuous Persian SVG text without negative letter spacing, outlines, or glyph shadows. The selection engine is unchanged.

The SQLite catalog is authoritative at runtime; `src/data/catalog.json` seeds a new database and defines the approved color palette. Invitation results include an explicit optional Telegram action; it sends only activity ID, mood, optional title, consent, and a short-lived idempotency key. It never sends the greeting or visitor metadata. **All invitations use the site owner's fixed Telegram destination**, including invitations created by other visitors; this is stated next to the action.

Run the API from the repository root (the public wheel requires it for the dynamic catalog; Telegram credentials remain optional):

```sh
python3 -m venv .venv
.venv/bin/pip install -r api/requirements-dev.txt
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000 --no-access-log
# separate terminal
pnpm dev
# API tests, with mocked Telegram only
.venv/bin/python -m pytest api -q
```

Vite proxies `/api` to localhost:8000. No Telegram credentials are needed for development; notification availability is false until both backend variables are configured. If the API is offline, the public app shows a retryable catalog error rather than using stale bundled options. See [Telegram setup and operations](api/README.md). No secrets belong in `VITE_` variables.

### Persistent administration and live catalog

The API initializes a persistent SQLite catalog, settings, history, and Telegram diagnostics during lifespan startup. Compose stores it in a named volume; local Uvicorn defaults to ignored `data/date-wheel.sqlite3`, configurable through `DATABASE_PATH`. `/admin` provides secure login, an activity editor and shared wheel preview, a recorded-history view with filters, an overview of consented events, Halloween copy controls, and Telegram diagnostics/test actions. The public wheel consumes `/api/catalog`; each new spin fetches fresh data and freezes its own result snapshot. Catalog errors never fall back to stale bundled activities. See [backend setup and API notes](api/README.md).
