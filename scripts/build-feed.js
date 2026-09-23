// Rewrite the original feed: same entries, same values, only g:image_link points to the
// generated 9:16 creative of the destination (when one exists). Also writes a review gallery.
// Output: dist/<market>/feed.xml, dist/<market>/index.html, dist/index.html
'use strict';
const fs = require('fs');
const path = require('path');
const { parseFeed, readJson, writeJson } = require('./lib/feed');

const ROOT = path.resolve(__dirname, '..');
const markets = readJson(path.join(ROOT, 'config/markets.json'));

function baseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  if (repo) {
    const [owner, name] = repo.split('/');
    return `https://${owner.toLowerCase()}.github.io/${name}`;
  }
  return 'http://localhost:8080';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildFeed(market) {
  const base = baseUrl();
  const xml = fs.readFileSync(path.join(ROOT, 'data', `${market}.xml`), 'utf8');
  const { header, entries, footer } = parseFeed(xml);
  const { destinations, lookup } = readJson(path.join(ROOT, 'build', market, 'destinations.json'));
  const rendered = readJson(path.join(ROOT, 'dist', market, 'rendered.json'), {});

  let replaced = 0;
  const out = [header];
  for (const e of entries) {
    const key = lookup[`${e.destCity}|${e.destIata}`];
    const r = key && rendered[key];
    if (r) {
      // the ?v= cache-buster changes with the price so Meta re-fetches the image when the sticker changes
      const url = `${base}/${market}/${r.file}?v=${r.price}`;
      out.push(e.raw.replace(/<g:image_link>[\s\S]*?<\/g:image_link>/, `<g:image_link>${url}</g:image_link>`));
      replaced++;
    } else {
      out.push(e.raw);
    }
    out.push('\n');
  }
  out.push(footer);
  const distDir = path.join(ROOT, 'dist', market);
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'feed.xml'), out.join(''));

  // Review gallery
  const cfg = markets[market];
  const withImage = destinations.filter((d) => rendered[d.key]);
  const cards = withImage
    .map(
      (d) => `<figure><img loading="lazy" src="${rendered[d.key].file}?v=${rendered[d.key].price}" alt="${esc(d.city)}"><figcaption><b>${esc(d.city)}</b>${d.country ? `, ${esc(d.country)}` : ''}<br>${d.routes} routes · from ${cfg.currencySymbol}${d.minPrice} · ${d.iatas.join('/')}${rendered[d.key].placeholder ? ' · <i>placeholder photo</i>' : ''}</figcaption></figure>`
    )
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Jetcost Meta feed · ${market}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#f5f6f8;color:#1a1a1a}h1{font-size:22px}code{background:#fff;padding:2px 6px;border-radius:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)}
img{width:100%;aspect-ratio:9/16;object-fit:cover;display:block}figcaption{padding:10px 12px;font-size:13px;line-height:1.4}</style></head><body>
<h1>Jetcost · Meta flight feed · ${market}</h1>
<p>Feed: <code>${base}/${market}/feed.xml</code> · ${entries.length} entries · ${destinations.length} destinations · ${withImage.length} with generated creative (${replaced} entries rewritten) · built ${new Date().toISOString()}</p>
<div class="grid">${cards}</div></body></html>`;
  fs.writeFileSync(path.join(distDir, 'index.html'), html);
  writeJson(path.join(distDir, 'summary.json'), { market, base, entries: entries.length, destinations: destinations.length, withImage: withImage.length, replaced, builtAt: new Date().toISOString() });
  console.log(`${market}: feed written (${entries.length} entries, ${replaced} image links rewritten, ${withImage.length}/${destinations.length} destinations with creative)`);
  return { entries: entries.length, replaced, withImage: withImage.length };
}

function buildRootIndex() {
  const distRoot = path.join(ROOT, 'dist');
  const rows = Object.keys(markets)
    .filter((m) => fs.existsSync(path.join(distRoot, m, 'summary.json')))
    .map((m) => {
      const s = readJson(path.join(distRoot, m, 'summary.json'));
      return `<li><a href="${m}/">${m}</a> · <a href="${m}/feed.xml">feed.xml</a> · ${s.entries} entries · ${s.withImage}/${s.destinations} destinations with creative · built ${s.builtAt}</li>`;
    })
    .join('\n');
  fs.writeFileSync(path.join(distRoot, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Jetcost Meta feeds</title><style>body{font-family:system-ui,sans-serif;margin:32px}</style></head><body><h1>Jetcost · Meta flight feeds</h1><ul>${rows}</ul></body></html>`);
  fs.writeFileSync(path.join(distRoot, '.nojekyll'), '');
}

if (require.main === module) {
  const market = process.argv[2] || process.env.MARKET || 'us-en';
  buildFeed(market);
  buildRootIndex();
}
module.exports = { buildFeed, buildRootIndex };
