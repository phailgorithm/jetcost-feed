// Download the original Jetcost feed for one market into data/<market>.xml
'use strict';
const fs = require('fs');
const path = require('path');
const { readJson } = require('./lib/feed');

const ROOT = path.resolve(__dirname, '..');
const markets = readJson(path.join(ROOT, 'config/markets.json'));

async function main() {
  const market = process.argv[2] || process.env.MARKET || 'us-en';
  const cfg = markets[market];
  if (!cfg) throw new Error(`Unknown market ${market}. Known: ${Object.keys(markets).join(', ')}`);
  const url = `https://www.travel-tools.org/feeds/rtg/flights/facebook2?ws=jetcost&cc=${cfg.cc}&lc=${cfg.lc}&secure=1`;
  const out = path.join(ROOT, 'data', `${market}.xml`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`Fetching ${url}`);
  const res = await fetch(url, { headers: { 'user-agent': 'jetcost-meta-feed/1.0' } });
  if (!res.ok) throw new Error(`Feed fetch failed: HTTP ${res.status}`);
  const xml = await res.text();
  if (!xml.includes('<entry>')) throw new Error('Downloaded document contains no <entry> elements');
  fs.writeFileSync(out, xml);
  const n = (xml.match(/<entry>/g) || []).length;
  console.log(`Saved ${out} (${(xml.length / 1e6).toFixed(1)} MB, ${n} entries)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
