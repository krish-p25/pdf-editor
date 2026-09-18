import type { PDFDocumentProxy } from 'pdfjs-dist';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const key = (sourceIndex: number, scale: number) => `${sourceIndex}@${scale.toFixed(2)}`;

/**
 * Render a source page to a PNG data URL at the given scale.
 *
 * Results are cached by (page, scale): thumbnails and the main canvas request
 * the same pages constantly during editing, and rasterising is by far the most
 * expensive thing the app does. In-flight requests are deduplicated too, so a
 * burst of re-renders during a zoom does not queue up duplicate work.
 */
export function renderPage(
  proxy: PDFDocumentProxy,
  sourceIndex: number,
  scale: number,
): Promise<string> {
  const k = key(sourceIndex, scale);

  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(k);
  if (pending) return pending;

  const job = (async () => {
    try {
      const page = await proxy.getPage(sourceIndex + 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not acquire a 2D canvas context');

      await page.render({ canvasContext: context, viewport }).promise;

      const url = canvas.toDataURL('image/png');
      // Bound the cache: data URLs are large and a long session at many zoom
      // levels would otherwise grow it without limit.
      if (cache.size > 40) cache.clear();
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
