// Build-time camera catalogue fetch.
//
// Why build time and not runtime: none of these agencies send CORS headers on
// their JSON, so a static page cannot fetch the catalogues from the browser.
// Images are exempt (an <img> tag is not a CORS request), so we resolve the
// list here, commit the result, and let the browser load the pictures directly.
// This is also what makes `pnpm dev` work on a clean clone with no network.

import { writeFileSync } from 'node:fs';

const TIMEOUT = 30_000;

async function getText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
const getJSON = async (url) => JSON.parse(await getText(url));

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
};

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// --- sources -----------------------------------------------------------

async function tfl() {
  const places = await getJSON('https://api.tfl.gov.uk/Place/Type/JamCam');
  return places.flatMap((p) => {
    const props = Object.fromEntries(
      (p.additionalProperties ?? []).map((a) => [a.key, a.value])
    );
    if (props.available !== 'true' || !props.imageUrl) return [];
    return [{
      id: `tfl:${p.id}`,
      name: p.commonName,
      lat: num(p.lat), lon: num(p.lon),
      img: props.imageUrl,
      source: 'Transport for London',
      region: 'London, UK',
    }];
  });
}

async function ontario() {
  const cams = await getJSON('https://511on.ca/api/v2/get/cameras');
  return cams.flatMap((c) => {
    const view = (c.Views ?? []).find((v) => v.Status === 'Enabled' && v.Url);
    if (!view) return [];
    return [{
      id: `on:${c.Id}`,
      name: c.Location || c.Roadway || `Camera ${c.Id}`,
      lat: num(c.Latitude), lon: num(c.Longitude),
      img: view.Url,
      source: 'Ontario 511',
      region: 'Ontario, Canada',
    }];
  });
}

async function caltrans() {
  const districts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const out = [];
  const results = await Promise.allSettled(
    districts.map(async (d) => {
      const dd = String(d).padStart(2, '0');
      const json = await getJSON(
        `https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`
      );
      return { d, rows: json.data ?? [] };
    })
  );
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const row of r.value.rows) {
      const c = row.cctv;
      const url = c?.imageData?.static?.currentImageURL;
      if (!url || !c?.inService || c.inService === 'false') continue;
      out.push({
        id: `ca:${r.value.d}:${c.index}`,
        name: c.location?.locationName ?? 'Caltrans camera',
        lat: num(c.location?.latitude), lon: num(c.location?.longitude),
        img: url,
        source: 'Caltrans',
        region: 'California, USA',
      });
    }
  }
  return out;
}

async function newZealand() {
  const xml = await getText('https://trafficnz.info/service/traffic/rest/4/cameras/all');
  const blocks = xml.match(/<camera>[\s\S]*?<\/camera>/g) ?? [];
  return blocks.flatMap((b) => {
    const img = tag(b, 'imageUrl');
    if (!img || tag(b, 'offline') === 'true') return [];
    return [{
      id: `nz:${tag(b, 'id')}`,
      name: tag(b, 'description') ?? 'NZ camera',
      lat: num(tag(b, 'latitude')), lon: num(tag(b, 'longitude')),
      img: img.startsWith('http') ? img : `https://trafficnz.info${img}`,
      source: 'NZ Transport Agency',
      region: 'New Zealand',
    }];
  });
}

// --- run ---------------------------------------------------------------

const SOURCES = [
  ['Transport for London', tfl],
  ['Ontario 511', ontario],
  ['Caltrans', caltrans],
  ['NZ Transport Agency', newZealand],
];

const cameras = [];
for (const [label, fn] of SOURCES) {
  try {
    const got = await fn();
    cameras.push(...got);
    console.log(`  ${label.padEnd(22)} ${String(got.length).padStart(5)}`);
  } catch (err) {
    // A dead agency must not fail the build — the committed catalogue still works.
    console.warn(`  ${label.padEnd(22)}  FAILED: ${err.message}`);
  }
}

// Interleave sources so the first screenful spans the world rather than
// showing 40 consecutive London side-streets. This is presentation, but it is
// the difference between the demo reading as "the world" and "one motorway".
const bySource = new Map();
for (const c of cameras) {
  if (!bySource.has(c.source)) bySource.set(c.source, []);
  bySource.get(c.source).push(c);
}
const queues = [...bySource.values()];
const shuffled = [];
for (let i = 0; shuffled.length < cameras.length; i++) {
  for (const q of queues) if (i < q.length) shuffled.push(q[i]);
}

const payload = {
  generated: new Date().toISOString(),
  count: shuffled.length,
  sources: [...bySource].map(([name, list]) => ({
    name, count: list.length, region: list[0].region,
  })),
  cameras: shuffled,
};

writeFileSync(
  new URL('../public/cameras.json', import.meta.url),
  JSON.stringify(payload)
);
console.log(`\n  total ${shuffled.length} cameras from ${bySource.size} sources`);
