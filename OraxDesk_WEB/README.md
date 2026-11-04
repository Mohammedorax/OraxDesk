# OraxDesk website

The marketing / download site, published from this folder as a fully static
Next.js export at **https://mohammedorax.github.io/OraxDesk/**.

## Commands (run inside `OraxDesk_WEB/`)

| Command | What it does |
| --- | --- |
| `bun install` | install dependencies |
| `bun run dev` | dev server on `:3000` |
| `bun run build` | bake the latest release data, then `next build` → `out/` |
| `bun run images` | regenerate `public/screens/` from the committed masters |
| `bun run fonts` | regenerate `public/fonts/` WOFF2 subsets from the app's OTFs |
| `bun run lint` | ESLint |

## How the pieces fit

- **Static export** — `next.config.ts` sets `output: "export"`,
  `basePath: "/OraxDesk"`, `assetPrefix`, `trailingSlash` and
  `images.unoptimized`. There is no server: everything in `out/` is served
  as-is by GitHub Pages.
- **Release data** — `fetch-release.mjs` (runs at the start of every build)
  fetches the latest release from the GitHub API and bakes it into
  `src/lib/tajarib/releases.json`; download buttons deep-link to
  `releases/latest/download/<asset>`. Platforms whose asset is missing in
  that release fall back to the releases page instead of a 404 link.
  `releases.fallback.json` keeps offline builds working. A release with
  fewer assets than the currently baked one never replaces it.
- **Asset paths under basePath** — Next 16 does not apply `basePath`
  uniformly, so each case is handled where it differs:
  - `next/image` srcs (unoptimized) → prefixed by hand via
    `NEXT_PUBLIC_BASE_PATH` (see `src/lib/tajarib/content.ts`);
  - OG/Twitter metadata images → left relative; basePath is added
    automatically by the metadata resolver;
  - `@font-face` `url()` in `globals.css` → prefixed by hand; plain CSS
    never receives the asset prefix.
- **Screenshots** — full-resolution masters live in `../docs/images/screens/`;
  `bun run images` regenerates WebP / AVIF / PNG variants (1600 / 1280 /
  1024) into `public/screens/`.
- **Fonts** — Tajarib OTFs live in `../ui/public/fonts/`; `bun run fonts`
  subsets them into arabic/latin WOFF2 faces with `unicode-range` splitting
  (browsers download only what the page needs).

## Deployment

`.github/workflows/site.yml` builds and deploys on every push that touches
`OraxDesk_WEB/**`, and monthly (cron) so the baked download links follow the
newest release. The repo's Pages source must be "GitHub Actions"
(already configured; first-time enablement needs admin rights, so it was
created once via the API).
