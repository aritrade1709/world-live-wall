# World Live Wall

> 4106 public traffic cameras from four countries, live, on one page.

**[Live demo](https://aritrade1709.github.io/world-live-wall/)** · Built in one session with [Claude Code](https://claude.com/claude-code), 6 September 2026

## The hard part

The interesting problem here is not fetching cameras. It is that a browser allows
roughly **six concurrent connections per origin** on HTTP/1.1, and 944 of these
cameras live on a single host.

Point `<img>` tags at all of them and the requests queue six at a time. Tiles arrive
minutes stale, the tab stalls while the backlog drains, and — because every camera
needs a cache-busting query string to return a fresh frame — none of it is served
from cache. Scrolling makes it worse: each new row piles more work behind a queue
that is already thousands deep.

So the wall is a scheduler, not a grid. Three rules:

1. **Only what is on screen is live.** An `IntersectionObserver` with a one-screen
   `rootMargin` decides which tiles are eligible; scrolling away cancels queued work
   for tiles that left the viewport.
2. **Concurrency is capped per origin and globally** (4 and 24). Requests are keyed
   by hostname, so a slow agency cannot starve a fast one — without this, London
   waits behind Ontario's backlog.
3. **Refreshes are spread across the interval.** Each tile gets a deterministic
   phase offset, so a screenful of 40 cameras refreshes as a steady trickle rather
   than 40 simultaneous requests every 15 seconds.

Images are decoded off-DOM and swapped in only once ready, so a tile never blanks
while its replacement loads. Requests that hang are timed out at 15s, because a
dead camera holding a connection slot starves every other camera on its origin.

The header shows in-flight and queued counts live, which is the honest way to show
that the scheduler is doing something.

Two smaller decisions worth noting:

- **The camera catalogue is resolved at build time.** None of these agencies send
  CORS headers on their JSON, so a static page cannot fetch the lists at runtime.
  Images are exempt — an `<img>` tag is not a CORS request — so the build script
  resolves the catalogue, commits it, and the browser loads the pictures directly.
  This is also what lets the app run offline on a clean clone.
- **Sources are interleaved.** Sorting by source would show 40 consecutive London
  side-streets on first paint. Interleaving means the first screen spans four
  countries and several times of day at once, which is the entire point.

## Run it locally

```bash
pnpm i
pnpm dev
```

No environment variables, no API keys, no accounts.

```bash
pnpm test       # scheduler tests
pnpm cameras    # re-resolve the camera catalogue from source agencies
```

## Stack

Vite + TypeScript, no framework and no dependencies at runtime. Deployed as a
static site to GitHub Pages.

## Data sources

All four publish these cameras deliberately and openly. Nothing here touches a
private or unsecured camera.

| Source | Cameras | Region |
|---|---|---|
| [Transport for London](https://api.tfl.gov.uk/) | 798 | London, UK |
| [Ontario 511](https://511on.ca/) | 944 | Ontario, Canada |
| [Caltrans](https://cwwp2.dot.ca.gov/) | 2,115 | California, USA |
| [NZ Transport Agency](https://trafficnz.info/) | 249 | New Zealand |

Camera images are loaded directly from each agency and are not cached,
proxied or restreamed by this project.

## Why this exists

Part of a series: one small project a day, each explained in 30 seconds.

## License

MIT
