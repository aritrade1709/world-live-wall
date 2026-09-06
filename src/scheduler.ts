// Loading thousands of live JPEGs is not a rendering problem, it is a
// connection-scheduling problem.
//
// Browsers allow roughly six concurrent connections per origin on HTTP/1.1.
// All 944 Ontario cameras live on one host, so refreshing them naively queues
// 944 requests six at a time: tiles arrive minutes stale, and the tab stalls
// while the queue drains. Three rules fix it:
//
//   1. only refresh what is on screen (IntersectionObserver drives the set)
//   2. cap in-flight requests per origin, and globally
//   3. spread each tile's refresh across the interval instead of firing
//      every visible tile on the same tick
//
// Images are fetched off-DOM first and only swapped in once decoded, so a
// tile never blanks while its replacement loads.

export interface LoadJob {
  key: string;
  url: string;
  onLoad: (url: string) => void;
  onError: () => void;
}

export class OriginPool {
  private inFlight = 0;
  private perOriginActive = new Map<string, number>();
  private queues = new Map<string, LoadJob[]>();
  // Keys that are queued OR in flight. Released only when a request settles,
  // so a tile whose load is still outstanding cannot enqueue a second one.
  private activeKeys = new Set<string>();

  // Written out rather than as constructor parameter properties so Node can
  // run this file directly under type stripping — the tests import the real
  // source instead of a build artefact.
  private readonly perOriginLimit: number;
  private readonly globalLimit: number;

  constructor(perOriginLimit: number, globalLimit: number) {
    this.perOriginLimit = perOriginLimit;
    this.globalLimit = globalLimit;
  }

  get stats() {
    let queued = 0;
    for (const q of this.queues.values()) queued += q.length;
    return { inFlight: this.inFlight, queued };
  }

  submit(job: LoadJob): void {
    // A tile still waiting from a previous tick must not stack up a second
    // request; without this the queue grows without bound on a slow origin.
    if (this.activeKeys.has(job.key)) return;
    this.activeKeys.add(job.key);

    const origin = originOf(job.url);
    const q = this.queues.get(origin);
    if (q) q.push(job);
    else this.queues.set(origin, [job]);
    this.pump();
  }

  /** Drop anything queued that is no longer wanted (scrolled out of view). */
  cancelExcept(keep: Set<string>): void {
    for (const [origin, q] of this.queues) {
      const next = q.filter((j) => keep.has(j.key));
      for (const j of q) if (!keep.has(j.key)) this.activeKeys.delete(j.key);
      if (next.length) this.queues.set(origin, next);
      else this.queues.delete(origin);
    }
  }

  private pump(): void {
    let progressed = true;
    while (progressed && this.inFlight < this.globalLimit) {
      progressed = false;
      for (const [origin, q] of this.queues) {
        if (!q.length) { this.queues.delete(origin); continue; }
        if (this.inFlight >= this.globalLimit) break;
        if ((this.perOriginActive.get(origin) ?? 0) >= this.perOriginLimit) continue;
        this.start(origin, q.shift()!);
        progressed = true;
      }
    }
  }

  private start(origin: string, job: LoadJob): void {
    this.inFlight++;
    this.perOriginActive.set(origin, (this.perOriginActive.get(origin) ?? 0) + 1);

    const img = new Image();
    img.decoding = 'async';
    let settled = false;

    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.inFlight--;
      this.activeKeys.delete(job.key);
      const n = (this.perOriginActive.get(origin) ?? 1) - 1;
      if (n > 0) this.perOriginActive.set(origin, n);
      else this.perOriginActive.delete(origin);
      ok ? job.onLoad(img.src) : job.onError();
      this.pump();
    };

    // A camera that never responds would otherwise hold a slot forever and
    // starve the rest of that origin.
    const timer = setTimeout(() => done(false), 15_000);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = job.url;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid';
  }
}

/** Cameras serve cached frames unless the URL changes. */
export function bustCache(url: string, nonce: number): string {
  return url + (url.includes('?') ? '&' : '?') + '_=' + nonce;
}

/**
 * Spread refreshes evenly through the interval rather than firing every
 * visible tile at once. Deterministic in the index so a tile keeps its slot
 * across scrolls instead of jumping the queue each time it reappears.
 */
export function phaseOffset(index: number, interval: number, slots: number): number {
  return ((index % slots) / slots) * interval;
}
