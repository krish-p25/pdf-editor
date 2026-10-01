import type { PDFDocumentProxy } from 'pdfjs-dist';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/**
 * Budget for cached page bitmaps, in characters of base64 (roughly bytes).
 *
 * Counting entries is the wrong bound now that supersampling is on: a
 * thumbnail and an A4 page at 400% zoom differ by three orders of magnitude,
 * so a fixed entry count either thrashes thumbnails or holds hundreds of
 * megabytes of full-page rasters.
 */
const CACHE_BUDGET_CHARS = 96 * 1024 * 1024;

let cachedChars = 0;

/** Insert a render, evicting oldest-first until the cache is within budget. */
function remember(k: string, url: string): void {
  const existing = cache.get(k);
  if (existing !== undefined) cachedChars -= existing.length;

  cache.set(k, url);
  cachedChars += url.length;

  // Map iterates in insertion order, so the first key is the oldest.
  while (cachedChars > CACHE_BUDGET_CHARS && cache.size > 1) {
    const oldest = cache.keys().next().value as string;
    cachedChars -= cache.get(oldest)?.length ?? 0;
    cache.delete(oldest);
  }
}

/**
 * Largest canvas edge we will rasterise to.
 *
 * The cap must be on pixel dimensions rather than on the scale factor: an A4
 * page at 400% zoom on a 2x display would otherwise need a 4760x6736 canvas
 * (32 megapixels), which browsers either refuse outright or render very
 * slowly.
 */
const MAX_CANVAS_EDGE = 4096;

/**
 * Lowest multiple of the display scale we will ever rasterise at.
 *
 * A PDF point is 1px at scale 1, so rendering a page at its CSS size means
 * rasterising at 72 DPI — ten-point text becomes ten pixels tall and looks
 * soft next to the same file in a PDF viewer, which re-renders the vectors at
 * device resolution for whatever zoom it is showing.
 *
 * Rendering at 2x and letting the browser downsample gives 144 DPI at 100%
 * zoom, and supersampling antialiases thin strokes better than rasterising
 * directly at 1x does.
 */
const MIN_RENDER_SCALE = 2;

/** Physical pixels per CSS pixel, clamped so a 3x phone does not blow the cap. */
export function devicePixelScale(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(Math.max(dpr, 1), 3);
}

/**
 * The scale to rasterise at, given the scale the page is displayed at.
 *
 * Two floors apply. The device pixel ratio stops the bitmap being stretched
 * across more physical pixels than it has, and MIN_RENDER_SCALE stops a
 * dpr-1 display being served a 72 DPI raster of what is really vector art.
 *
 * The result is then clamped so neither canvas edge exceeds MAX_CANVAS_EDGE.
 * The clamp must be applied to pixel dimensions rather than to the scale
 * factor, because how large a given scale gets depends on the page size.
 */
export function rasterScale(
  cssScale: number,
  dpr: number,
  pageWidth: number,
  pageHeight: number,
): number {
  const desired = cssScale * Math.max(dpr, MIN_RENDER_SCALE);
  return Math.min(desired, MAX_CANVAS_EDGE / pageWidth, MAX_CANVAS_EDGE / pageHeight);
}

const key = (sourceIndex: number, scale: number) => `${sourceIndex}@${scale.toFixed(3)}`;

/**
 * Render a source page to a PNG data URL.
 *
 * `cssScale` is the size the page is DISPLAYED at, in CSS pixels per PDF point.
 * The actual raster is taken at `cssScale * devicePixelRatio` so one rendered
 * pixel lands on one physical pixel; CSS then scales the bitmap back down and
 * the page stays as crisp as the original vector content. Rasterising at the
 * CSS scale alone is what makes a PDF look pixelated on a HiDPI screen.
 *
 * Results are cached by (page, scale) because thumbnails and the main canvas
 * request the same pages constantly during editing, and rasterising is by far
 * the most expensive thing the app does. In-flight requests are deduplicated
 * too, so a burst of re-renders during a zoom does not queue duplicate work.
 */
export function renderPage(
  proxy: PDFDocumentProxy,
  sourceIndex: number,
  cssScale: number,
): Promise<string> {
  const requested = cssScale * devicePixelScale();
  const k = key(sourceIndex, requested);

  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(k);
  if (pending) return pending;

  const job = (async () => {
    try {
      const page = await proxy.getPage(sourceIndex + 1);

      const base = page.getViewport({ scale: 1 });
      const scale = rasterScale(cssScale, devicePixelScale(), base.width, base.height);

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Could not acquire a 2D canvas context');

      await page.render({ canvasContext: context, viewport }).promise;

      // PNG keeps text edges crisp; JPEG would introduce ringing artefacts
      // around glyphs, which is exactly what we are trying to avoid.
      const url = canvas.toDataURL('image/png');

      remember(k, url);
      return url;
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, job);
  return job;
}

export function clearRenderCache(): void {
  cache.clear();
  inflight.clear();
  cachedChars = 0;
}
