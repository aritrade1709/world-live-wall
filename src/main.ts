import { OriginPool, bustCache, phaseOffset } from './scheduler';
import './style.css';

interface Camera {
  id: string; name: string;
  lat: number | null; lon: number | null;
  img: string; source: string; region: string;
}

const REFRESH_MS = 15_000;
const LIGHTBOX_REFRESH_MS = 5_000;
const PER_ORIGIN = 4;
const GLOBAL_MAX = 24;
const PHASE_SLOTS = 24;

// Same-origin fetch rather than a bundled import: inlining 4,000 cameras put
// 900 kB of JSON through the JS parser before the first tile could paint.
const catalogue = (await fetch("cameras.json").then((r) => r.json())) as {
  count: number; cameras: Camera[];
};
const cameras = catalogue.cameras;
const pool = new OriginPool(PER_ORIGIN, GLOBAL_MAX);

interface Tile {
  cam: Camera; index: number;
  el: HTMLElement; img: HTMLImageElement;
  visible: boolean; dead: boolean; loaded: boolean;
  nextAt: number; nonce: number;
}

const tiles: Tile[] = [];
let liveCount = 0;

// --- build the grid ----------------------------------------------------

const grid = document.getElementById('grid')!;
const frag = document.createDocumentFragment();

cameras.forEach((cam, index) => {
  const el = document.createElement('button');
  el.className = 'tile';
  el.type = 'button';
  el.setAttribute('aria-label', `${cam.name} — ${cam.region}`);

  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'eager'; // visibility is managed by the scheduler, not the browser

  const cap = document.createElement('span');
  cap.className = 'cap';
  cap.textContent = cam.name;

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = cam.region;

  el.append(img, cap, badge);
  frag.append(el);

  const tile: Tile = {
    cam, index, el, img,
    visible: false, dead: false, loaded: false,
    nextAt: 0, nonce: 0,
  };
  el.addEventListener('click', () => openLightbox(tile));
  tiles.push(tile);
});

grid.append(frag);

// --- visibility --------------------------------------------------------

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const tile = tiles[Number((entry.target as HTMLElement).dataset.i)];
      if (!tile) continue;
      tile.visible = entry.isIntersecting;
      if (entry.isIntersecting && !tile.loaded && !tile.dead) {
        // stagger the first paint so a full screen of tiles does not thunder
        tile.nextAt = performance.now() + phaseOffset(tile.index, 1200, PHASE_SLOTS);
      }
    }
  },
  { rootMargin: '300px' }, // start a screen early so scrolling feels instant
);

tiles.forEach((t, i) => {
  t.el.dataset.i = String(i);
  observer.observe(t.el);
});

// IntersectionObserver does not report until after the first frame — and not at
// all while the tab is hidden. Seed roughly one screenful so the wall starts
// filling immediately; the observer corrects this on its first callback.
const seed = Math.min(tiles.length, Math.ceil(innerWidth / 210) * Math.ceil(innerHeight / 120) + 12);
for (let i = 0; i < seed; i++) tiles[i].visible = true;

// --- refresh loop ------------------------------------------------------

function tick() {
  const now = performance.now();
  const wanted = new Set<string>();
  // While the tab is hidden, finish painting what has never loaded but stop
  // refreshing what has — no point spending a viewer's bandwidth on tiles
  // nobody is looking at, while still having the wall ready on return.
  const refreshing = !document.hidden;

  for (const tile of tiles) {
    if (!tile.visible || tile.dead) continue;
    if (!refreshing && tile.loaded) continue;
    wanted.add(tile.cam.id);
    if (now < tile.nextAt) continue;

    tile.nextAt = now + REFRESH_MS + phaseOffset(tile.index, REFRESH_MS, PHASE_SLOTS);
    const url = bustCache(tile.cam.img, ++tile.nonce);

    pool.submit({
      key: tile.cam.id,
      url,
      onLoad: (src) => {
        // already decoded off-DOM, so this swap paints without a blank frame
        tile.img.src = src;
        if (!tile.loaded) { tile.loaded = true; liveCount++; tile.el.classList.add('on'); }
      },
      onError: () => {
        // public cameras go offline constantly; stop scheduling a dead one
        tile.dead = true;
        tile.el.classList.add('dead');
      },
    });
  }

  pool.cancelExcept(wanted);
}

// A 250ms interval, not requestAnimationFrame: rAF polls 60x a second to check
// timers that fire every 15s, and it is suspended outright in a background tab
// — which silently stops the wall. Pausing while hidden is still the behaviour
// we want (no point burning a viewer's bandwidth on tiles nobody is looking
// at), so it is done explicitly here rather than left to a side effect.
setInterval(tick, 250);
tick();

// --- header stats ------------------------------------------------------

const elTotal = document.getElementById('stat-total')!;
const elLive = document.getElementById('stat-live')!;
const elFlight = document.getElementById('stat-flight')!;
const elQueued = document.getElementById('stat-queued')!;

elTotal.textContent = cameras.length.toLocaleString();

setInterval(() => {
  const { inFlight, queued } = pool.stats;
  elLive.textContent = liveCount.toLocaleString();
  elFlight.textContent = String(inFlight);
  elQueued.textContent = String(queued);
}, 200);

// --- region filter -----------------------------------------------------

const filters = document.getElementById('filters')!;
const regions = ['All', ...new Set(cameras.map((c) => c.region))];

regions.forEach((region) => {
  const b = document.createElement('button');
  b.className = 'chip' + (region === 'All' ? ' active' : '');
  b.textContent = region;
  b.addEventListener('click', () => {
    filters.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    b.classList.add('active');
    for (const t of tiles) {
      t.el.hidden = region !== 'All' && t.cam.region !== region;
    }
  });
  filters.append(b);
});

// --- lightbox ----------------------------------------------------------

const box = document.getElementById('lightbox')!;
const boxImg = document.getElementById('lightbox-img') as HTMLImageElement;
const boxName = document.getElementById('lightbox-name')!;
const boxMeta = document.getElementById('lightbox-meta')!;
let boxTile: Tile | null = null;
let boxTimer: number | undefined;

function openLightbox(tile: Tile) {
  boxTile = tile;
  boxName.textContent = tile.cam.name;
  const coords = tile.cam.lat != null && tile.cam.lon != null
    ? ` · ${tile.cam.lat.toFixed(3)}, ${tile.cam.lon.toFixed(3)}`
    : '';
  boxMeta.textContent = `${tile.cam.region} · ${tile.cam.source}${coords}`;
  boxImg.src = tile.img.src || bustCache(tile.cam.img, 1);
  box.hidden = false;

  clearInterval(boxTimer);
  boxTimer = setInterval(() => {
    if (boxTile) boxImg.src = bustCache(boxTile.cam.img, Date.now());
  }, LIGHTBOX_REFRESH_MS) as unknown as number;
}

function closeLightbox() {
  box.hidden = true;
  boxTile = null;
  clearInterval(boxTimer);
}

box.addEventListener('click', closeLightbox);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
