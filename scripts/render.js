// Composite the dynamic copy (city, price, CTA...) on top of each cached photo.
// Output: dist/<market>/images/<key>.jpg (1080x1920). Only destinations with a cached photo are rendered.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readJson, writeJson } = require('./lib/feed');

const ROOT = path.resolve(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'cache', 'photos');
const TEMPLATE = path.join(ROOT, 'template', 'creative.html');
const markets = readJson(path.join(ROOT, 'config/markets.json'));

function formatPrice(amount, cfg) {
  const n = Math.round(amount).toLocaleString('en-US');
  return `${cfg.currencySymbol}${n}`;
}

function photoFor(key, placeholder) {
  const p = path.join(PHOTO_DIR, `${key}.jpg`);
  if (fs.existsSync(p)) return p;
  if (placeholder && fs.existsSync(placeholder)) return placeholder;
  return null;
}

async function render({ market, destinations, placeholder = null, only = null, limit = Infinity }) {
  const cfg = markets[market];
  const outDir = path.join(ROOT, 'dist', market, 'images');
  fs.mkdirSync(outDir, { recursive: true });
  const overrides = readJson(path.join(ROOT, 'config/overrides.json'), {});

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto('file://' + TEMPLATE, { waitUntil: 'load' });

  const rendered = {};
  let n = 0;
  for (const d of destinations) {
    if (only && !only.includes(d.key)) continue;
    if (overrides[d.key] && overrides[d.key].skip) continue;
    const photo = photoFor(d.key, placeholder);
    if (!photo) continue;
    if (n >= limit) break;
    const data = {
      photo: 'file://' + photo,
      city: d.city,
      calling: cfg.texts.calling,
      from: cfg.texts.from,
      price: formatPrice(d.minPrice, cfg),
      badge: cfg.texts.badge,
      cta: cfg.texts.cta.replace('{city}', d.city),
      footer: cfg.texts.footer,
    };
    await page.evaluate((payload) => window.renderCreative(payload), data);
    const file = path.join(outDir, `${d.key}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    rendered[d.key] = { file: `images/${d.key}.jpg`, price: d.minPrice, currency: d.currency, placeholder: photo === placeholder };
    n++;
    if (n % 50 === 0) console.log(`  rendered ${n}`);
  }
  await browser.close();
  writeJson(path.join(ROOT, 'dist', market, 'rendered.json'), rendered);
  console.log(`${market}: rendered ${n} creatives -> ${outDir}`);
  return rendered;
}

if (require.main === module) {
  const market = process.argv[2] || process.env.MARKET || 'us-en';
  const { destinations } = readJson(path.join(ROOT, 'build', market, 'destinations.json'));
  render({
    market,
    destinations,
    placeholder: process.env.PLACEHOLDER ? path.resolve(process.env.PLACEHOLDER) : null,
    only: process.env.ONLY ? process.env.ONLY.split(',') : null,
    limit: process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity,
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
module.exports = { render, formatPrice };
