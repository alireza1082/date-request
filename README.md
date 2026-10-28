# چرخِ قرار · Date Wheel

A small, shareable Persian date picker built around a hand-crafted spinning wheel. It is a static React application with no backend, database, account, or runtime API dependency.

**Version:** 1.1.0

## Design notes

The visual direction pairs warm paper and pomegranate tones with a brass-edged wheel, restrained ornament, and a calm Persian headline. This release tightens the wheel's spin into anticipation, momentum, and a gentle landing; settled labels turn upright again, and the result sheet reveals its copy in a quiet sequence. The ten short labels keep the wheel readable on small screens. Motion stays on transforms and opacity, and the wheel uses an immediate landing for people who request reduced motion.

For this polish pass, I reviewed Dribbble's [Mobile UI - spin wheel](https://dribbble.com/shots/24216175-Mobile-UI-spin-wheel), the [Awwwards Magic Bottle feature](https://www.awwwards.com/sites/magic-bottle) and its [studio case study](https://www.nk.studio/work/magic-bottle/), plus [Mobbin's public reference-library overview](https://mobbin.com/). The object-as-gift story and invitation to explore informed the wheel's tactile framing and the reveal's paced entrance. Behance's Fortune's Wheel case appeared in search, but its direct page returned 403, so I did not use it for visual analysis. The Persian composition remains original.

References: [Dribbble date app work](https://dribbble.com/shots/22984521-Dating-Mobile-iOS-App), [Dribbble couples wheel search](https://dribbble.com/search/app-wheel), [Behance Fortune's Wheel redesign](https://www.behance.net/gallery/181820855/Game-UI-Redesign-Fortunes-Wheel), [Awwwards-recognized Magic Bottle experience](https://www.nk.studio/work/magic-bottle), [Mobbin product reference library](https://mobbin.com/), and [Decide Now! wheel app](https://apps.apple.com/fr/app/decide-now-roue-de-la-fortune/id383718755?platform=watch).

## Stack

- React 19 and TypeScript strict mode
- Vite for development and static production assets
- SVG wheel with a pure, independently tested geometry and selection engine
- Vazirmatn Variable bundled locally through Fontsource
- Vitest for unit tests and Playwright for browser tests
- Native HTML dialog and Web Share API with Clipboard fallback

## Requirements

- Node.js 20.19+ or 22.12+
- pnpm 12+

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
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser tests check the rendered pointer against the selected SVG sector using the final computed transform, test rapid-click protection and repeated spins, exercise clipboard fallback, and check target viewport widths from 320px to 1440px.

## Architecture

```text
src/
  app/                         Page composition and focus restoration
  data/activities.ts           Curated Persian date options
  features/
    results/                   Accessible result dialog and sharing
    wheel/
      components/              SVG wheel and tactile controls
      engine/                  Secure selection and angle calculations
      hooks/                   Spin animation lifecycle
  styles/                      Tokens, responsive layout, and motion
e2e/                           Playwright interaction and viewport tests
```

`wheel-engine.ts` owns segment geometry, unbiased selection with `crypto.getRandomValues`, rotation normalization, and final pointer alignment. `useWheelSpin` selects one index and passes it through animation to the result state; the visible wheel and result use that same selection. `activities.ts` keeps copy and segment colors out of the UI components.

## Editing the activity list

Edit `src/data/activities.ts`. Keep each ID unique and keep `wheelLabel` concise; the initial wheel is intentionally limited to ten equal-size segments for legibility. Each option includes a longer result title and description, emoji, segment color, and a light or dark label setting. A unit test checks every label/background pair for at least 4.5:1 contrast. The engine supports a changed number of options and recalculates every sector evenly.

## Deployment

Docker Compose is the recommended deployment. It binds the unprivileged Nginx container to `127.0.0.1:18080`; add the documented location snippet to an existing VPS Nginx HTTPS virtual host. Start with [deploy/README.md](deploy/README.md).

For direct static hosting, run `pnpm install --frozen-lockfile` and `pnpm build`, then serve `dist/` using [deploy/nginx-static.conf.example](deploy/nginx-static.conf.example). No backend or runtime API is required. The bundled font makes no external font request.
