// Generate (and cache) one 9:16 destination photo per destination.
// Providers: "openai" (GPT Image models, default) or "gemini" (Gemini image models).
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
const PROVIDER = (process.env.PHOTO_PROVIDER || 'openai').toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
const OPENAI_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'high';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const CONCURRENCY = parseInt(process.env.PHOTO_CONCURRENCY || process.env.GEMINI_CONCURRENCY || '3', 10);
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

async function withRetry(fn, label, attempt = 1) {
  const res = await fn();
  if (res.status === 429 || res.status >= 500) {
    const text = (await res.text()).slice(0, 600);
    if (attempt >= 5) throw new Error(`${label} HTTP ${res.status} after ${attempt} attempts: ${text}`);
    const wait = Math.min(60000, 2000 * 2 ** attempt);
    console.log(`  ${label} HTTP ${res.status}, retrying in ${wait / 1000}s: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    await sleep(wait);
    return withRetry(fn, label, attempt + 1);
  }
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${(await res.text()).slice(0, 600)}`);
  return res.json();
}

// OpenAI Images API: arbitrary sizes (multiples of 16, aspect between 1:3 and 3:1).
// 1088x1920 is the closest to 9:16; we crop 4 px per side to get exactly 1080x1920.
async function callOpenAI(prompt) {
  const json = await withRetry(
    () =>
      fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          prompt,
          n: 1,
          size: '1088x1920',
          quality: OPENAI_QUALITY,
          output_format: 'jpeg',
          output_compression: 95,
        }),
      }),
    'OpenAI'
  );
  const b64 = json.data && json.data[0] && json.data[0].b64_json;
  if (!b64) throw new Error(`OpenAI returned no image: ${JSON.stringify(json).slice(0, 300)}`);
  return { buffer: Buffer.from(b64, 'base64'), model: OPENAI_MODEL, usage: json.usage };
}

async function callGemini(prompt) {
  const json = await withRetry(
    () =>
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } },
        }),
      }),
    'Gemini'
  );
  const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
  const img = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!img) {
    const reason = ((json.candidates || [])[0] || {}).finishReason || (json.promptFeedback && json.promptFeedback.blockReason) || 'no image in response';
    throw new Error(`Gemini returned no image (${reason})`);
  }
  return { buffer: Buffer.from(img.inlineData.data, 'base64'), model: GEMINI_MODEL };
}

function checkKey() {
  if (PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  if (PROVIDER === 'gemini' && !process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  if (!['openai', 'gemini'].includes(PROVIDER)) throw new Error(`Unknown PHOTO_PROVIDER ${PROVIDER}`);
}

async function generatePhotos({ destinations, maxNew = 100, only = null }) {
  checkKey();
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const manifest = readJson(MANIFEST, {});
  const overrides = readJson(path.join(ROOT, 'config/overrides.json'), {});
  const generate = PROVIDER === 'openai' ? callOpenAI : callGemini;
  const modelLabel = PROVIDER === 'openai' ? `${OPENAI_MODEL} (${OPENAI_QUALITY})` : GEMINI_MODEL;

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
  console.log(`Photos: ${destinations.length} destinations, ${todo.length} to generate now (max ${maxNew}), provider ${PROVIDER}, model ${modelLabel}`);

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
        const { buffer, model, usage } = await generate(prompt);
        await sharp(buffer)
          .resize(OUT_W, OUT_H, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 88, mozjpeg: true })
          .toFile(file);
        manifest[d.key] = { city: d.city, country: d.country, provider: PROVIDER, model, promptVersion: PROMPT_VERSION, createdAt: new Date().toISOString() };
        ok++;
        console.log(`  ok  ${d.key}${usage && usage.output_tokens ? ` (${usage.output_tokens} output tokens)` : ''}`);
      } catch (e) {
        failed++;
        const prev = manifest[d.key] || {};
        manifest[d.key] = { ...prev, city: d.city, country: d.country, promptVersion: PROMPT_VERSION, failed: (prev.promptVersion === PROMPT_VERSION ? prev.failed || 0 : 0) + 1, lastError: String(e.message).slice(0, 300) };
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
