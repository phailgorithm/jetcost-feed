// Parsing helpers for the Jetcost "facebook2" Atom / Google Base flight feed.
// The feed is ~30 MB for the US market (43k entries), so we parse with a
// single regex pass instead of a DOM parser.
'use strict';

const fs = require('fs');
const path = require('path');

const ENTRY_RE = /<entry>([\s\S]*?)<\/entry>/g;

function tag(block, name) {
  const m = block.match(new RegExp(`<g:${name}>([\\s\\S]*?)<\\/g:${name}>`));
  if (!m) return '';
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1].trim();
  return v;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse the whole feed. Returns { header, entries, footer } where entries carry the raw block too. */
function parseFeed(xml) {
  const first = xml.indexOf('<entry>');
  const last = xml.lastIndexOf('</entry>');
  if (first < 0 || last < 0) throw new Error('No <entry> elements found in feed');
  const header = xml.slice(0, first);
  const footer = xml.slice(last + '</entry>'.length);
  const entries = [];
  let m;
  ENTRY_RE.lastIndex = 0;
  while ((m = ENTRY_RE.exec(xml)) !== null) {
    const block = m[1];
    const id = tag(block, 'id');
    const title = tag(block, 'title');
    const priceRaw = tag(block, 'price');
    const pm = priceRaw.match(/([\d.,]+)\s*([A-Z]{3})/);
    const idParts = id.split('-'); // flights-USen-AAE-IST
    const sep = title.indexOf(' - ');
    entries.push({
      raw: m[0],
      id,
      title,
      originCity: sep >= 0 ? title.slice(0, sep).trim() : title,
      destCity: sep >= 0 ? title.slice(sep + 3).trim() : '',
      originIata: idParts[2] || '',
      destIata: idParts[3] || '',
      price: pm ? parseFloat(pm[1].replace(',', '.')) : NaN,
      currency: pm ? pm[2] : '',
      link: decodeEntities(tag(block, 'link')),
      imageLink: tag(block, 'image_link'),
    });
  }
  return { header, entries, footer };
}

function slugify(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

module.exports = { parseFeed, slugify, readJson, writeJson, decodeEntities };
