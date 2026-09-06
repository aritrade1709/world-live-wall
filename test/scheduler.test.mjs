// Verifies the connection scheduler, which is the whole point of this project.
// Run: pnpm test
//
// Node 24 strips the types from the imported .ts directly, so there is no build
// step and the test runs against the exact source the app ships.

import assert from 'node:assert/strict';
import { OriginPool, bustCache, phaseOffset } from '../src/scheduler.ts';

// --- fake Image, so nothing touches the network -------------------------
const pending = [];
globalThis.Image = class {
  decoding = 'async';
  onload = null;
  onerror = null;
  #src = '';
  set src(v) { this.#src = v; pending.push(this); }
  get src() { return this.#src; }
  settle(ok) { ok ? this.onload?.() : this.onerror?.(); }
};

const job = (key, url, sink = {}) => ({
  key, url,
  onLoad: () => { sink.loaded = (sink.loaded ?? 0) + 1; },
  onError: () => { sink.errored = (sink.errored ?? 0) + 1; },
});

let failures = 0;
function test(name, fn) {
  pending.length = 0;
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// --- the actual failure this project exists to avoid ---------------------

test('caps concurrent requests per origin', () => {
  const pool = new OriginPool(4, 100);
  for (let i = 0; i < 50; i++) pool.submit(job(`a${i}`, `https://one.example/${i}.jpg`));
  assert.equal(pending.length, 4, 'should have exactly 4 in flight on one origin');
  assert.equal(pool.stats.inFlight, 4);
  assert.equal(pool.stats.queued, 46);
});

test('a slow origin does not starve a fast one', () => {
  const pool = new OriginPool(4, 100);
  // 944 Ontario-style cameras on one host, then a handful elsewhere
  for (let i = 0; i < 944; i++) pool.submit(job(`on${i}`, `https://slow.example/${i}.jpg`));
  for (let i = 0; i < 3; i++) pool.submit(job(`nz${i}`, `https://fast.example/${i}.jpg`));
  const hosts = pending.map((p) => new URL(p.src).host);
  assert.equal(hosts.filter((h) => h === 'slow.example').length, 4);
  assert.equal(hosts.filter((h) => h === 'fast.example').length, 3,
    'fast origin must not queue behind the slow one');
});

test('respects the global ceiling across origins', () => {
  const pool = new OriginPool(4, 6);
  for (let i = 0; i < 10; i++) pool.submit(job(`a${i}`, `https://a.example/${i}.jpg`));
  for (let i = 0; i < 10; i++) pool.submit(job(`b${i}`, `https://b.example/${i}.jpg`));
  assert.equal(pool.stats.inFlight, 6, 'global cap must win over per-origin');
});

test('completing a request admits the next one', () => {
  const pool = new OriginPool(2, 100);
  for (let i = 0; i < 5; i++) pool.submit(job(`a${i}`, `https://one.example/${i}.jpg`));
  assert.equal(pool.stats.inFlight, 2);
  pending[0].settle(true);
  assert.equal(pool.stats.inFlight, 2, 'slot should be refilled immediately');
  assert.equal(pool.stats.queued, 2);
});

test('a failed load still frees its slot', () => {
  const sink = {};
  const pool = new OriginPool(1, 100);
  pool.submit(job('a', 'https://one.example/a.jpg', sink));
  pool.submit(job('b', 'https://one.example/b.jpg', sink));
  pending[0].settle(false);
  assert.equal(sink.errored, 1);
  assert.equal(pool.stats.inFlight, 1, 'the queued job must start after a failure');
});

test('does not stack duplicate requests for the same tile', () => {
  const pool = new OriginPool(1, 100);
  pool.submit(job('same', 'https://one.example/x.jpg'));
  pool.submit(job('same', 'https://one.example/x.jpg'));
  pool.submit(job('same', 'https://one.example/x.jpg'));
  assert.equal(pool.stats.inFlight + pool.stats.queued, 1,
    'a tile still waiting must not enqueue itself again');
});

test('scrolling away cancels queued work', () => {
  const pool = new OriginPool(1, 1);
  for (let i = 0; i < 20; i++) pool.submit(job(`t${i}`, `https://one.example/${i}.jpg`));
  assert.equal(pool.stats.queued, 19);
  pool.cancelExcept(new Set(['t5', 't6']));
  assert.equal(pool.stats.queued, 2, 'only still-visible tiles stay queued');
});

test('a cancelled tile can be requested again later', () => {
  const pool = new OriginPool(1, 1);
  pool.submit(job('a', 'https://one.example/a.jpg'));
  pool.submit(job('b', 'https://one.example/b.jpg'));
  pool.cancelExcept(new Set(['a']));
  assert.equal(pool.stats.queued, 0);
  pool.submit(job('b', 'https://one.example/b.jpg'));
  assert.equal(pool.stats.queued, 1, 'cancelling must clear the dedupe key too');
});

// --- helpers -------------------------------------------------------------

test('cache busting picks the right separator', () => {
  assert.equal(bustCache('https://x/a.jpg', 3), 'https://x/a.jpg?_=3');
  assert.equal(bustCache('https://x/a?v=1', 3), 'https://x/a?v=1&_=3');
});

test('refreshes are spread across the interval, not bunched', () => {
  const offsets = new Set();
  for (let i = 0; i < 24; i++) offsets.add(phaseOffset(i, 15000, 24));
  assert.equal(offsets.size, 24, 'consecutive tiles must land in distinct slots');
  assert.equal(phaseOffset(0, 15000, 24), 0);
  assert.equal(phaseOffset(5, 15000, 24), phaseOffset(29, 15000, 24),
    'offsets must be stable per tile across scrolls');
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
