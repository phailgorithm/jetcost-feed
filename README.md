# Jetcost · Meta flight feed with generated 9:16 creatives

Takes the original Jetcost flight feed (`travel-tools.org/feeds/rtg/flights/facebook2`), keeps every
entry and value untouched, and swaps the single generic `g:image_link` for a **per-destination 9:16
creative** (1080×1920):

- destination photo at sunset generated once with **OpenAI GPT Image** (`gpt-image-2.5-sunburst`, quality high; Gemini supported as alternative provider) and cached in `cache/photos/`
- dynamic copy composited on top with an HTML template + headless Chromium:
  Jetcost logo, `STILL AVAILABLE` badge, `[CITY] CALLING.`, `FROM $<min price>` sticker,
  `Compare flights to [City] →` CTA and `prices can change any day`

The result is published on GitHub Pages:

```
https://<owner>.github.io/<repo>/us-en/feed.xml     <- point the Meta catalog data source here
https://<owner>.github.io/<repo>/us-en/             <- review gallery of all creatives
```

## How it works (nightly GitHub Action)

1. `scripts/fetch-feed.js` downloads the original feed for each market in `config/markets.json`.
2. `scripts/aggregate.js` groups the ~44k routes by **destination city** (split by country using the
   OpenFlights airport database, so "London, UK" and "London, Ontario" get different photos) and
   computes the `from` price = lowest price among all routes to that destination.
3. `scripts/generate-photos.js` asks the image model (OpenAI by default, 1088×1920 cropped to 1080×1920) for a
   text-free 9:16 photo of every destination that does not have one yet (max `MAX_NEW_PHOTOS` per run,
   default 100, so the cache grows incrementally).
   Photos are committed back to the repo, so each destination is paid for once.
4. `scripts/render.js` composites the copy on every cached photo → `dist/<market>/images/<key>.jpg`.
   No image-model call here: price changes only re-render the overlay.
5. `scripts/build-feed.js` rewrites the feed: entries whose destination has a creative get
   `image_link = https://…/us-en/images/<key>.jpg?v=<price>` (the `?v=` changes with the price so Meta
   re-fetches the image); all other entries keep the original image. Output is deployed to Pages.

Images are only generated for destinations, not for routes: exact dates and the live route price reach
each viewer through Meta's own template tags in the ad copy.

## Setup

1. Repository secret `OPENAI_API_KEY` (Settings → Secrets and variables → Actions); `GEMINI_API_KEY` only if you
   run with provider `gemini`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Run the workflow manually once (Actions → *Build Meta flight feed* → Run workflow), choosing how many
   photos to generate. It then runs every night at 03:00 UTC.

## Configuration

- `config/markets.json`: markets (feed `cc`/`lc`), currency symbol and all on-image texts.
- `config/overrides.json`: per-destination prompt tweaks (`place` or full `prompt`), `skip`, `force`.
- `scripts/generate-photos.js`: `PROMPT_VERSION` (bump to regenerate every photo); provider/model/quality via
  `PHOTO_PROVIDER`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY` (or `GEMINI_MODEL`), all exposed as workflow inputs.
- `template/creative.html`: the layout (fonts in `assets/fonts`, logo in `assets/logo.png`).

## Local development

```bash
npm install
npx playwright install chromium
cp test/fixture-us-en.xml data/us-en.xml         # or: node scripts/fetch-feed.js us-en
node scripts/aggregate.js us-en
node scripts/dev-placeholder.js                  # text-free placeholder photo, no API key needed
PLACEHOLDER=build/placeholder.jpg node scripts/render.js us-en
GITHUB_REPOSITORY=owner/repo node scripts/build-feed.js us-en
# real photos: OPENAI_API_KEY=... ONLY=rome-italy,paris-france node scripts/generate-photos.js us-en
```
