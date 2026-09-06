# World Live Wall

**[aritrade1709.github.io/world-live-wall](https://aritrade1709.github.io/world-live-wall/)**

2,300 public traffic cameras from London and California, streaming live video on
a single page.

## What it is

Transport agencies publish thousands of roadside cameras for anyone to watch,
but each one lives behind its own map interface, one camera at a time. This puts
all of them on one wall.

Every camera on the wall is a live feed. The grid shows each one as a still that
refreshes every fifteen seconds; clicking a tile opens its video. Because the
cameras span an eight-hour time difference, the wall usually shows London in
darkness beside California in daylight.

## Using it

- **Click any tile** to open the full feed. Caltrans cameras play a live stream;
  London cameras play a short looping clip. Press `Escape` or click anywhere to
  close.
- **Hover a London tile** to preview its clip in place.
- **Filter by region** with the buttons at the top.
- The header counts how many cameras are on screen, and how many image requests
  are currently in flight or queued.

## How it works

### Connection scheduling

The wall holds 2,300 cameras, and two thirds of them serve images from a single
host. A browser allows roughly six concurrent connections per origin over
HTTP/1.1, so requesting them naively queues thousands of images six at a time:
tiles arrive minutes stale and the page stalls while the backlog drains. Every
refresh also needs a cache-busting query string to get a new frame, so none of it
is served from cache.

The wall is therefore a request scheduler rather than a grid of `<img>` tags:

- **Only what is on screen is live.** An `IntersectionObserver` with a
  one-screen margin decides which tiles are eligible, and scrolling away cancels
  queued work for tiles that have left the viewport.
- **Concurrency is capped per origin and globally**, at four and twenty-four.
  Requests are keyed by hostname, so a slow agency cannot starve a fast one.
- **Refreshes are spread across the interval.** Each tile gets a deterministic
  phase offset, so a screenful refreshes as a steady trickle instead of forty
  simultaneous requests every fifteen seconds.

Images are decoded off-DOM and swapped in only once ready, so a tile never blanks
while its replacement loads. Requests that hang are abandoned after fifteen
seconds, since a dead camera holding a connection slot starves every other camera
on its origin.

### Video

London cameras publish a short mp4 beside every still, which a plain `<video>`
element plays directly. Caltrans cameras publish live HLS; Safari and Chrome on
macOS play `.m3u8` natively, and everywhere else hls.js is loaded on demand the
first time an HLS camera is opened.

Video plays only on request, never in the grid — forty simultaneous streams would
reintroduce exactly the stall the scheduler prevents. The lightbox shows the
still first and upgrades to video once the stream is actually running, because an
HLS handshake takes a second or two.

### Building the camera catalogue

`pnpm cameras` resolves the camera list from each agency and writes
`public/cameras.json`. This happens at build time rather than in the browser
because the agencies do not send CORS headers on their JSON, so a static page
cannot fetch the lists at runtime. Images are exempt — an `<img>` tag is not a
CORS request — so the browser loads the pictures directly.

The build also filters out placeholder frames. Agencies keep a camera listed as
available while serving a stand-in image: a white *"Temporarily Unavailable"*
card, or a grey *"camera in use keeping London moving"* one. These arrive with
HTTP 200 at the same dimensions as real frames and are not byte-identical between
cameras, so they cannot be caught by error handling, image size, or file hashing.

They are caught by comparing pixels instead. Two working cameras never produce an
identical 8×8 downsample, while two cameras showing the same placeholder always
do. Every image is downsampled through ffmpeg and any that share a fingerprint
are dropped, along with any perfectly flat greyscale frame. A typical run rejects
about one image in six.

## Running locally

```bash
pnpm install
pnpm dev
```

No environment variables, no API keys, no accounts.

| Command | |
|---|---|
| `pnpm dev` | development server |
| `pnpm build` | production build |
| `pnpm test` | scheduler tests |
| `pnpm cameras` | rebuild the camera catalogue from the agencies |

`pnpm cameras` needs ffmpeg on your `PATH` (or set `FFMPEG=/path/to/ffmpeg`) for
placeholder filtering, and takes a few minutes because it fetches and measures
every image. Without ffmpeg it still works, skipping that step.

## Built with

Vite and TypeScript, no framework. hls.js is the only runtime dependency, loaded
from a CDN and only by browsers without native HLS support. Deployed as a static
site to GitHub Pages.

## Data sources

Both agencies publish these cameras openly and without an API key. Camera images
and video are loaded directly from each agency; nothing is cached, proxied or
restreamed here.

| Source | Cameras | Region | Video |
|---|---|---|---|
| [Transport for London](https://api.tfl.gov.uk/) | 786 | London, UK | mp4 clips |
| [Caltrans](https://cwwp2.dot.ca.gov/) | 1,514 | California, USA | live HLS |

## License

MIT
