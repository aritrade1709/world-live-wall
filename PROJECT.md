# 001 — World Live Wall

**Pitch:** 2,924 public traffic cameras streaming live video, from London and California, on one page.
**Status:** `built`
**Live:** https://aritrade1709.github.io/world-live-wall/
**Repo:** https://github.com/aritrade1709/world-live-wall
**Scores:** IMP 5/5 · UNH 4/5 · Effort M

## The one hard part

Browsers allow ~6 concurrent connections per origin on HTTP/1.1, and 2,135 of
the 2,924 cameras — 73% — are on one host (`cwwp2.dot.ca.gov`). Naive refreshing
queues them six at a time: tiles arrive minutes stale and the tab stalls. The
wall is therefore a request scheduler — viewport-gated, per-origin capped,
phase-offset — not a grid of `<img>` tags.

## Next action

Decide the globe/map view (see below), then `/make-episode`.

## Run it

```bash
pnpm i && pnpm dev     # no env vars
pnpm test              # 10 scheduler tests
pnpm cameras           # re-resolve catalogue from agencies
```

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-09-07 | Placeholder frames rejected at build time via ffmpeg | Agencies serve "camera in use" and "Temporarily Unavailable" cards with HTTP 200 at real frame dimensions, and the copies are not byte-identical, so neither onerror, size nor hashing catches them. They are pure greyscale (0.00 mean channel spread vs 2.16 for the next real camera, median 11.56). Browser cannot measure it — S3 sends no CORS headers, so the canvas is tainted. Rejected 21 on the last run. |
| 2026-09-07 | Ontario 511 and NZ removed from the fetcher entirely | Every camera they returned was discarded by the video-only filter; keeping them only slowed the build. |
| 2026-09-07 | Stills-only cameras dropped; video-capable only | Aritra's call. A wall of stills reads as stock photography. Cost: Ontario 511 and NZ leave entirely, so coverage narrows from four regions to two (London and California). The concurrency story got stronger, not weaker — 73% of what remains is on one origin. |
| 2026-09-07 | Removed the per-tile LIVE badge | Once every camera streams, a badge on every tile carries no information and covers the picture. The header states it once. |
| 2026-09-07 | Added video playback on click and hover | Stills alone read as stock photography and undercut the credibility of the whole thing. 2,753 cameras publish real video; TfL as mp4 loops, Caltrans as live HLS. |
| 2026-09-07 | Video on demand only, never in the grid | Forty concurrent streams is exactly the stall the scheduler exists to prevent. Hover previews mp4 only (~170 kB, instant); HLS is click-only. |
| 2026-09-07 | hls.js lazy-loaded from CDN, native HLS preferred | Safari and macOS Chrome play .m3u8 natively; loading 150 kB for them is waste. Verified both paths in real Chrome, forcing the fallback by denying canPlayType. |
| 2026-09-07 | LIVE badge only when playback actually started | Autoplay can be refused. A frozen first frame under a LIVE badge is worse than an honest play button, so the badge follows `video.paused`. |
| 2026-09-07 | Custom domain removed from the account | `aritficialintelligence.com` is no longer owned by Aritra and is now a parked page controlled by someone else. Its CNAME on `aritrade1709.github.io` was redirecting every Pages URL on the account to it. |
| 2026-09-06 | GitHub Pages, not Cloudflare Pages (studio default) | Pure static, and `gh` is already authenticated with `workflow` scope — Cloudflare would have needed a second browser login from Aritra for no gain. Movable later. |
| 2026-09-06 | Catalogue resolved at build time, committed | Agencies send no CORS headers on their JSON, so a static page cannot fetch the lists at runtime. Images are exempt from CORS. Also makes a clean clone work offline. |
| 2026-09-06 | Catalogue fetched at runtime from `public/`, not imported | Bundling 4,106 cameras put 900 kB of JSON through the JS parser before first paint. Same-origin fetch: bundle went 902 kB → 5 kB. |
| 2026-09-06 | Vanilla TS, no framework | It is a grid of images plus a scheduler; React would add per-tile overhead and explain nothing in 30 seconds. |
| 2026-09-06 | `setInterval` for the tick loop, not `requestAnimationFrame` | rAF polls 60x/sec to check 15s timers, and is suspended outright in a background tab — which silently stopped the wall. Pausing when hidden is still wanted, so it is now explicit. |
| 2026-09-06 | Sources interleaved in the catalogue | Source-ordered, the first screen is 40 London side-streets. Interleaved, it spans four countries and several times of day — that simultaneity is the demo. |

## Known bugs / rough edges

- `pnpm cameras` now takes a few minutes: it fetches and measures every image
  through ffmpeg. Needs ffmpeg on PATH (or `FFMPEG=/path`); without it the
  placeholder check is skipped with a warning rather than failing the build.
- Placeholder rejection is a build-time snapshot. A camera that starts serving
  a placeholder after the catalogue was built will show one until it is re-run.
  Re-run `pnpm cameras` before a shoot.

- The hls.js fallback is verified in Chrome by forcing `canPlayType` to deny
  native HLS. Not tested on a real Windows or Linux browser.
- Some Caltrans HLS streams are slow to hand shake or simply down; the lightbox
  keeps the refreshing still visible when that happens.

- Individual cameras go offline constantly; they fade out and are marked `offline`.
  Expect a handful of dead tiles on any given load. This is normal and visible.
- Caltrans images are the largest (up to ~1 MB each); a full screen of California
  is noticeably heavier than a screen of London.
- While the tab is hidden, tiles that have never loaded will still load once, but
  loaded tiles stop refreshing. Intentional — see decisions.
- The catalogue is a build-time snapshot. Cameras decommissioned since the last
  `pnpm cameras` run will show as offline until it is re-run.

## Demo notes

- The first screen is the whole hook: four countries, different times of day, at once.
- Header shows `in flight` / `queued` live — that is the scheduler, visible.
- Click any tile for a fullscreen view with location, agency and coordinates.
- Region chips filter to one country; New Zealand at night against California in
  daylight reads well on camera.

## Data sources

| Source | Free | Notes |
|---|---|---|
| Transport for London | yes, no key | 789 cameras; mp4 loop + still per camera, both on S3 |
| Caltrans | yes, no key | 2,135 with HLS across 12 districts; single image origin, the concurrency bottleneck |
| ~~Ontario 511~~ | — | dropped 2026-09-07: stills only |
| ~~NZ Transport Agency~~ | — | dropped 2026-09-07: stills only |
