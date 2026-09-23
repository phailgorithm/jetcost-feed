// Dev helper: builds a text-free "sunset skyline" placeholder photo so the template can be
// previewed without calling Gemini. Output: build/placeholder.jpg (not committed).
'use strict';
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const out = path.join(ROOT, 'build', 'placeholder.jpg');

const W = 1080, H = 1920;
const buildings = [];
let x = -20;
let seed = 7;
function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
while (x < W + 40) {
  const w = 40 + Math.floor(rnd() * 90);
  const h = 180 + Math.floor(rnd() * 520);
  buildings.push(`<rect x="${x}" y="${H - 560 - h + 300}" width="${w}" height="${h + 400}" fill="#1a1c2e"/>`);
  for (let wy = H - 560 - h + 330; wy < H - 300; wy += 34) {
    for (let wx = x + 8; wx < x + w - 10; wx += 22) if (rnd() > 0.55) buildings.push(`<rect x="${wx}" y="${wy}" width="10" height="16" fill="#ffb95a" opacity="${0.5 + rnd() * 0.5}"/>`);
  }
  x += w + 6;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#1b2a55"/><stop offset=".35" stop-color="#5a5f9a"/><stop offset=".55" stop-color="#e9825a"/><stop offset=".68" stop-color="#ffb347"/><stop offset=".75" stop-color="#2a2540"/><stop offset="1" stop-color="#0b0d18"/>
</linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<circle cx="700" cy="${H * 0.66}" r="120" fill="#ffd27a" opacity=".9"/>
${buildings.join('\n')}
</svg>`;
fs.mkdirSync(path.dirname(out), { recursive: true });
sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(out).then(() => console.log('placeholder ->', out));
