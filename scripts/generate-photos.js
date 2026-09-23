// Generate (and cache) one 9:16 destination photo per destination with Gemini.
// Photos are text-free backgrounds; the dynamic copy is composited later by render.js.
// Cache: cache/photos/<key>.jpg + cache/photos/manifest.json (committed to the repo).
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { readJson, writeJson } = require('./lib/feed');

const ROOT = path.resolve(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'cache', 'photos');
const MANIFEST = path.join(PHOTO_DIR, 'manifest.json');

const PROMPT_VERSION = 1; // bump to force regeneration of every photo
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const API_KEY = process.env.GEMINI_API_KEY;
const CONCURRENCY = parseInt(process.env.GEMINI_CONCURRENCY || '3', 10);
const OUT_W = 1080;
const OUT_H = 1920;

function buildPrompt(dest, override) {
  if (override && override.prompt) return override.prompt;
  const place = (override && override.place) || (dest.country ? `${dest.city}, ${dest.country}` : dest.city);
  return (
    `A photorealistic travel photograph of ${place} at sunset. ` +
    `Clear, serene sky with warm orange and soft blue tones; warm golden lights illuminating the buildings and streets; ` +
    `the most iconic, instantly recognizable landmarks and skyline of this city in view, shot from an elevated viewpoint with a wide-angle lens. ` +
    `Vertical 9:16 composition: sky in the upper third, the city filling the lower two thirds, foreground slightly darker at the very bottom. ` +
    `High detail, editorial travel-magazine quality. ` +
    `No text, no letters, no signs, no logos, no watermarks, no people in the foreground.`
  );
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGemini(prompt, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`Gemini HTTP ${res.status} after ${attempt} attempts: ${(await res.text()).slice(0, 300)}`);
    const wait = Math.min(60000, 2000 * 2 ** attempt);
    console.log(`  HTTP ${res.status}, retrying in ${wait / 1000}s`);
    await sleep(wait);
    return callGemini(prompt, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = await res.json();
  const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
  const img = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!img) {
    const reason = ((json.candidates || [])[0] || {}).finishReason || (json.promptFeedback && json.promptFeedback.blockReason) || 'no image in response';
    throw new Error(`Gemini returned no image (${reason})`);
  }
  return Buffer.from(img.inlineData.data, 'base64');
}

async function generatePhotos({ destinations, maxNew = 100, only = null }) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not set');
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const manifest = readJson(MANIFEST, {});
  const overrides = readJson(path.join(ROOT, 'config/overrides.json'), {});

  const todo = [];
  for (const d of destinations) {
    const ov = overrides[d.key];
    if (ov && ov.skip) continue;
    if (only && !only.includes(d.key)) continue;
    const entry = manifest[d.key];
    const file = path.join(PHOTO_DIR, `${d.key}.jpg`);
    const fresh = entry && entry.promptVersion === PROMPT_VERSION && fs.existsSync(file) && !(ov && ov.force);
    if (fresh) continue;
    if (entry && entry.failed && entry.failed >= 3 && entry.promptVersion === PROMPT_VERSION) continue; // give up after 3 failures
    todo.push(d);
    if (todo.length >= maxNew) break;
  }
  console.log(`Photos: ${destinations.length} destinations, ${todo.length} to generate now (max ${maxNew}), model ${MODEL}`);

  let idx = 0;
  let ok = 0;
  let failed = 0;
  async function worker() {
    while (idx < todo.length) {
      const d = todo[idx++];
      const ov = overrides[d.key];
      const prompt = buildPrompt(d, ov);
      const file = path.join(PHOTO_DIR, `${d.key}.jpg`);
      try {
        const png = await callGemini(prompt);
        await sharp(png)
          .resize(OUT_W, OUT_H, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 86, mozjpeg: true })
          .toFile(file);
        manifest[d.key] = { city: d.city, country: d.country, model: MODEL, promptVersion: PROMPT_VERSION, createdAt: new Date().toISOString() };
        ok++;
        console.log(`  ok  ${d.key}`);
      } catch (e) {
        failed++;
        const prev = manifest[d.key] || {};
        manifest[d.key] = { ...prev, city: d.city, country: d.country, promptVersion: PROMPT_VERSION, failed: (prev.promptVersion === PROMPT_VERSION ? prev.failed || 0 : 0) + 1, lastError: String(e.message).slice(0, 200) };
        console.log(`  FAIL ${d.key}: ${e.message}`);
      }
      writeJson(MANIFEST, manifest);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  writeJson(MANIFEST, manifest);
  console.log(`Photos done: ${ok} generated, ${failed} failed`);
  return { ok, failed };
}

if (require.main === module) {
  const market = process.argv[2] || process.env.MARKET || 'us-en';
  const maxNew = parseInt(process.env.MAX_NEW_PHOTOS || '100', 10);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const { destinations } = readJson(path.join(ROOT, 'build', market, 'destinations.json'));
  generatePhotos({ destinations, maxNew, only }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
module.exports = { generatePhotos, buildPrompt, PROMPT_VERSION };
