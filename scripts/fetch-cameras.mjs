// Build-time camera catalogue fetch.
//
// Why build time and not runtime: none of these agencies send CORS headers on
// their JSON, so a static page cannot fetch the catalogues from the browser.
// Images are exempt (an <img> tag is not a CORS request), so we resolve the
// list here, commit the result, and let the browser load the pictures directly.
// This is also what makes `pnpm dev` work on a clean clone with no network.

import { writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const TIMEOUT = 30_000;

async function getText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
const getJSON = async (url) => JSON.parse(await getText(url));

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
      video: props.videoUrl ?? null,
      videoType: props.videoUrl ? 'mp4' : null,
      source: 'Transport for London',
      region: 'London, UK',
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
      const stream = c?.imageData?.streamingVideoURL || null;
      if (!url || !c?.inService || c.inService === 'false') continue;
      out.push({
        id: `ca:${r.value.d}:${c.index}`,
        name: c.location?.locationName ?? 'Caltrans camera',
        lat: num(c.location?.latitude), lon: num(c.location?.longitude),
        img: url,
        video: stream,
        videoType: stream ? 'hls' : null,
        source: 'Caltrans',
        region: 'California, USA',
      });
    }
  }
  return out;
}

// --- run ---------------------------------------------------------------

// Ontario 511 and the NZ Transport Agency were dropped on 2026-09-07: both
// publish stills only, and this wall is video-only.
const SOURCES = [
  ['Transport for London', tfl],
  ['Caltrans', caltrans],
];

const collected = [];
for (const [label, fn] of SOURCES) {
  try {
    const got = await fn();
    collected.push(...got);
    console.log(`  ${label.padEnd(22)} ${String(got.length).padStart(5)}`);
  } catch (err) {
    // A dead agency must not fail the build — the committed catalogue still works.
    console.warn(`  ${label.padEnd(22)}  FAILED: ${err.message}`);
  }
}

// --- placeholder rejection ----------------------------------------------
//
// Agencies keep a camera marked "available" while serving a stand-in image.
// Caltrans sends a white "Temporarily Unavailable" card, TfL a grey "camera in
// use keeping London moving" one. They arrive with HTTP 200, so onerror never
// fires; they are the same dimensions as real frames, so size does not separate
// them; and they are not byte-identical between cameras, so hashing the file
// does not either.
//
// Two signals catch them, and both need the pixels — which the browser cannot
// read, because these hosts send no CORS headers and the canvas would be
// tainted. So it happens here, at build time, with ffmpeg.
//
//   1. DUPLICATE FINGERPRINTS. Two real cameras never produce an identical 8x8
//      downsample; two cameras showing the same placeholder always do. On the
//      first full run this caught 514 of 2,924 cameras, the largest single
//      group being 155 identical images.
//
//   2. FLAT GREYSCALE. Catches a placeholder that happens to be showing on only
//      one camera, where there is no duplicate to pair it with. Synthetic text
//      on a flat ground measures 0.00 mean channel spread; the next real camera
//      measures 2.16, against a median of 11.56.
//
// Signal 1 does the heavy lifting; signal 2 is the backstop. An earlier version
// had only signal 2 and missed every Caltrans placeholder, because that card is
// white with BLUE text and therefore not greyscale at all.

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const SAT_THRESHOLD = 1.0;

function haveFfmpeg() {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/**
 * Mean per-pixel colour spread over an 8x8 downsample. 0 means greyscale.
 * Async on purpose: execFileSync blocks the event loop, which quietly turns
 * the worker pool below into a serial queue and takes the run from one minute
 * to well over ten.
 */
function downsample(buf) {
  const N = 8;
  return new Promise((resolve) => {
    const ff = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-i', 'pipe:0',
      '-vf', `scale=${N}:${N}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ]);
    const chunks = [];
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.on('error', () => resolve(null));
    ff.on('close', () => {
      const px = Buffer.concat(chunks);
      resolve(px.length >= N * N * 3 ? px : null);
    });
    ff.stdin.on('error', () => {});
    ff.stdin.end(buf);
  });
}

/** Mean per-pixel colour spread. 0 means a perfectly greyscale image. */
function saturationOf(px, N = 8) {
  let sum = 0;
  for (let i = 0; i < N * N; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    sum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return sum / (N * N);
}

async function dropPlaceholders(list) {
  if (!haveFfmpeg()) {
    console.warn('  ffmpeg not found — skipping placeholder rejection');
    return list;
  }

  const measured = [];
  let unreachable = 0;
  const queue = [...list];
  await Promise.all(Array.from({ length: 24 }, async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const res = await fetch(c.img, { signal: AbortSignal.timeout(TIMEOUT) });
        if (!res.ok) { unreachable++; continue; }
        const px = await downsample(Buffer.from(await res.arrayBuffer()));
        // an unreadable image is kept: better a rare bad tile than dropping a
        // working camera because ffmpeg choked on one frame
        if (!px) { measured.push({ cam: c, print: null, sat: null }); continue; }
        measured.push({
          cam: c,
          print: createHash('sha1').update(px).digest('hex'),
          sat: saturationOf(px),
        });
      } catch { unreachable++; }
    }
  }));

  const seen = new Map();
  for (const m of measured) {
    if (m.print) seen.set(m.print, (seen.get(m.print) ?? 0) + 1);
  }

  let dupes = 0, flat = 0;
  const keep = [];
  for (const m of measured) {
    if (m.print && seen.get(m.print) > 1) { dupes++; continue; }
    if (m.sat !== null && m.sat < SAT_THRESHOLD) { flat++; continue; }
    keep.push(m.cam);
  }

  console.log(`  rejected ${dupes} duplicate-frame placeholders, ${flat} flat greyscale, ${unreachable} unreachable`);
  return keep;
}

// Cameras that only publish stills are dropped: a wall of still images reads as
// stock photography, which is the one thing this must not look like. Every
// camera kept here can actually play. This removes Ontario 511 and New Zealand
// entirely, since neither publishes video.
const playable = collected.filter((c) => c.video);
console.log(`\n  dropped ${collected.length - playable.length} stills-only cameras`);
console.log('  checking every remaining camera for placeholder images...');
const cameras = await dropPlaceholders(playable);

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
    withVideo: list.filter((c) => c.video).length,
  })),
  cameras: shuffled,
};

writeFileSync(
  new URL('../public/cameras.json', import.meta.url),
  JSON.stringify(payload)
);
console.log(`  total ${shuffled.length} playable cameras from ${bySource.size} sources`);
