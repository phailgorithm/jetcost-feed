// Group the feed by destination city and compute the "from" price.
// Output: build/<market>/destinations.json (sorted by number of routes, desc)
'use strict';
const fs = require('fs');
const path = require('path');
const airports = require('airport-data');
const { parseFeed, slugify, readJson, writeJson } = require('./lib/feed');

const ROOT = path.resolve(__dirname, '..');

// IATA -> { country, city } from the OpenFlights dataset (metro codes like NYC/LON/ROM are absent)
const byIata = new Map();
for (const a of airports) if (a.iata && a.iata !== '\\N') byIata.set(a.iata, a);

function aggregate(market) {
  const xmlPath = path.join(ROOT, 'data', `${market}.xml`);
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const { entries } = parseFeed(xml);

  // Step 1: group by destination city name (as written in the feed title)
  const byCity = new Map();
  for (const e of entries) {
    if (!e.destCity || !Number.isFinite(e.price)) continue;
    let g = byCity.get(e.destCity);
    if (!g) byCity.set(e.destCity, (g = new Map()));
    // per IATA: collect routes
    let r = g.get(e.destIata);
    if (!r) g.set(e.destIata, (r = { routes: 0, min: Infinity, currency: e.currency, sampleLink: e.link }));
    r.routes++;
    if (e.price < r.min) r.min = e.price;
  }

  // Step 2: split each city group by country (London UK vs London Ontario, Melbourne AU vs Melbourne FL ...)
  const destinations = [];
  const lookup = {}; // "<destCity>|<destIata>" -> destination key (used by build-feed.js)
  for (const [city, iatas] of byCity) {
    const byCountry = new Map();
    const unknown = [];
    for (const [iata, r] of iatas) {
      const a = byIata.get(iata);
      if (a && a.country) {
        let c = byCountry.get(a.country);
        if (!c) byCountry.set(a.country, (c = { iatas: [], routes: 0, min: Infinity, currency: r.currency, sampleLink: r.sampleLink }));
        c.iatas.push(iata);
        c.routes += r.routes;
        c.min = Math.min(c.min, r.min);
      } else {
        unknown.push([iata, r]);
      }
    }
    // metro codes (NYC, LON, PAR ...) join the country with most routes in the same city group
    if (unknown.length) {
      let target = null;
      for (const [country, c] of byCountry) if (!target || c.routes > byCountry.get(target).routes) target = country;
      if (!target) {
        target = 'Unknown';
        byCountry.set(target, { iatas: [], routes: 0, min: Infinity, currency: unknown[0][1].currency, sampleLink: unknown[0][1].sampleLink });
      }
      const c = byCountry.get(target);
      for (const [iata, r] of unknown) {
        c.iatas.push(iata);
        c.routes += r.routes;
        c.min = Math.min(c.min, r.min);
      }
    }
    for (const [country, c] of byCountry) {
      const key = `${slugify(city)}-${slugify(country)}`;
      for (const iata of c.iatas) lookup[`${city}|${iata}`] = key;
      destinations.push({
        key,
        city,
        country: country === 'Unknown' ? '' : country,
        iatas: c.iatas.sort(),
        routes: c.routes,
        minPrice: Math.round(c.min),
        currency: c.currency,
        sampleLink: c.sampleLink,
      });
    }
  }
  destinations.sort((a, b) => b.routes - a.routes || a.key.localeCompare(b.key));

  const out = path.join(ROOT, 'build', market, 'destinations.json');
  writeJson(out, { market, generatedAt: new Date().toISOString(), entries: entries.length, destinations, lookup });
  console.log(`${market}: ${entries.length} entries -> ${destinations.length} destinations (${out})`);
  console.log('Top 10:', destinations.slice(0, 10).map((d) => `${d.city} [${d.iatas.join('/')}] ${d.routes} routes from ${d.minPrice} ${d.currency}`).join('\n        '));
  return destinations;
}

if (require.main === module) {
  const market = process.argv[2] || process.env.MARKET || 'us-en';
  aggregate(market);
}
module.exports = { aggregate };
