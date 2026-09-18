import type { PDFDocumentProxy } from 'pdfjs-dist';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/**
 * Largest canvas edge we will rasterise to.
 *
 * The cap must be on pixel dimensions rather than on the scale factor: an A4
 * page at 400% zoom on a 2x display would otherwise need a 4760x6736 canvas
 * (32 megapixels), which browsers either refuse outright or render very
 * slowly.
 */
const MAX_CANVAS_EDGE = 4096;

/** Physical pixels per CSS pixel, clamped so a 3x phone does not blow the cap. */
export function devicePixelScale(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(Math.max(dpr, 1), 3);
}

/**
 * The scale to rasterise at, given the scale the page is displayed at.
 *
 * Multiplying by the device pixel ratio is what keeps the page sharp: a
 * bitmap rendered at the CSS scale alone is stretched across `dpr` times as
 * many physical pixels and looks pixelated on any HiDPI screen.
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
  const desired = cssScale * dpr;
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

      // Bound the cache: these data URLs are large and a long session at many
      // zoom levels would otherwise grow it without limit.
      if (cache.size > 24) cache.clear();
      cache.set(k, url);
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
}
