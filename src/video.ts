// Video playback for the cameras that publish it.
//
// Two very different sources:
//   - Transport for London writes a short mp4 loop next to every still. A plain
//     <video> plays it cross-origin; no CORS involved, same as an <img>.
//   - Caltrans runs live HLS. Safari plays .m3u8 natively; everything else needs
//     hls.js, which is loaded lazily the first time an HLS camera is opened so
//     the 150 kB never touches anyone who only browses stills.
//
// Nothing here plays video in the grid. Forty simultaneous streams is exactly
// the stall the scheduler exists to prevent — video is on demand only.

const HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

let hlsLoader: Promise<any> | null = null;

function loadHls(): Promise<any> {
  if (!hlsLoader) {
    hlsLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HLS_CDN;
      s.onload = () => resolve((window as any).Hls);
      s.onerror = () => reject(new Error('hls.js failed to load'));
      document.head.append(s);
    });
  }
  return hlsLoader;
}

export function supportsNativeHls(video: HTMLVideoElement): boolean {
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

export interface Playback {
  stop: () => void;
}

/**
 * Point a <video> at a camera. Returns a handle that tears down the HLS
 * instance — without it, closing the lightbox leaves the stream downloading
 * in the background forever.
 */
export async function play(
  video: HTMLVideoElement,
  url: string,
  type: 'mp4' | 'hls',
): Promise<Playback> {
  video.muted = true;          // autoplay is blocked otherwise
  video.playsInline = true;
  video.loop = type === 'mp4'; // the TfL clips are ~10s and want looping

  if (type === 'mp4' || supportsNativeHls(video)) {
    video.src = url;
    await video.play().catch(() => {});
    return { stop: () => { video.pause(); video.removeAttribute('src'); video.load(); } };
  }

  const Hls = await loadHls();
  if (!Hls?.isSupported()) throw new Error('HLS unsupported in this browser');

  const hls = new Hls({ liveDurationInfinity: true, enableWorker: true });
  hls.loadSource(url);
  hls.attachMedia(video);
  await new Promise<void>((resolve) => {
    hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
    setTimeout(resolve, 6000); // do not hang the UI on a dead stream
  });
  await video.play().catch(() => {});

  return {
    stop: () => {
      video.pause();
      hls.destroy();
      video.removeAttribute('src');
      video.load();
    },
  };
}
