# 001 — World Live Wall

**Pitch:** 4,588 public traffic cameras from four countries; 2,753 stream live video.
**Status:** `built`
**Live:** https://aritrade1709.github.io/world-live-wall/
**Repo:** https://github.com/aritrade1709/world-live-wall
**Scores:** IMP 5/5 · UNH 4/5 · Effort M

## The one hard part

Browsers allow ~6 concurrent connections per origin on HTTP/1.1, and 944 of the
cameras are on a single host. Naive refreshing queues them six at a time: tiles
arrive minutes stale and the tab stalls. The wall is therefore a request
scheduler — viewport-gated, per-origin capped, phase-offset — not a grid of
`<img>` tags.

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
| Transport for London | yes, no key | S3-hosted JPEGs, ~798 available of 890 listed |
| Ontario 511 | yes, no key | JPEG per view id; single origin, the concurrency bottleneck |
| Caltrans | yes, no key | 12 district endpoints; largest images |
| NZ Transport Agency | yes, no key | XML catalogue, relative image paths |
