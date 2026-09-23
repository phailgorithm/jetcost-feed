// Full nightly pipeline for one or more markets:
//   fetch feed -> aggregate destinations -> generate missing photos (OpenAI or Gemini) -> render creatives -> rewrite feed
// Env: MARKETS (comma list, default us-en), MAX_NEW_PHOTOS (default 100), PHOTO_PROVIDER (openai|gemini),
//      OPENAI_API_KEY + OPENAI_IMAGE_MODEL + OPENAI_IMAGE_QUALITY, or GEMINI_API_KEY + GEMINI_MODEL, BASE_URL
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const { readJson } = require('./lib/feed');
const { aggregate } = require('./aggregate');
const { generatePhotos } = require('./generate-photos');
const { render } = require('./render');
const { buildFeed, buildRootIndex } = require('./build-feed');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const marketsToRun = (process.env.MARKETS || 'us-en').split(',').map((s) => s.trim()).filter(Boolean);
  const maxNew = parseInt(process.env.MAX_NEW_PHOTOS || '100', 10);
  const skipFetch = process.env.SKIP_FETCH === '1';

  for (const market of marketsToRun) {
    console.log(`\n=== ${market} ===`);
    if (!skipFetch) execFileSync('node', [path.join(__dirname, 'fetch-feed.js'), market], { stdio: 'inherit' });
    const destinations = aggregate(market);
    const hasKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (hasKey && maxNew > 0) {
      await generatePhotos({ destinations, maxNew });
    } else {
      console.log('Skipping photo generation (no API key or MAX_NEW_PHOTOS=0)');
    }
    await render({ market, destinations });
    buildFeed(market);
  }
  buildRootIndex();
  const manifest = readJson(path.join(ROOT, 'cache/photos/manifest.json'), {});
  const okPhotos = Object.values(manifest).filter((m) => !m.failed || m.failed === 0).length;
  console.log(`\nPhoto cache: ${okPhotos} photos available, ${Object.values(manifest).filter((m) => m.failed).length} with failures`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
