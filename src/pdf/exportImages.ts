import { zipSync } from 'fflate';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type ImageExportFormat = 'png' | 'jpeg';

/** Resolutions offered. 72 matches the PDF's own units; 300 is print quality. */
export const EXPORT_DPI_CHOICES = [72, 150, 300] as const;

/**
 * Largest canvas edge we rasterise to on export.
 *
 * Browsers refuse canvases somewhere past 16k pixels per edge, and many hit an
 * area limit well before that. An A4 page at 300 DPI is 2480x3508, so this
 * only ever bites on very large pages.
 */
export const MAX_EXPORT_EDGE = 8192;

/**
 * The pdf.js scale for a target DPI.
 *
 * A PDF point is 1/72 inch and pdf.js renders one point to one pixel at scale
 * 1, so the scale is DPI / 72 - capped on pixel dimensions, because how large a
 * given scale gets depends on the page size.
 */
export function exportScale(
  widthPt: number,
  heightPt: number,
  dpi: number,
  maxEdge: number = MAX_EXPORT_EDGE,
): number {
  return Math.min(dpi / 72, maxEdge / widthPt, maxEdge / heightPt);
}

const extensionOf = (format: ImageExportFormat): string => (format === 'png' ? 'png' : 'jpg');

export const mimeOf = (format: ImageExportFormat): string =>
  format === 'png' ? 'image/png' : 'image/jpeg';

/**
 * One filename per page, zero-padded so they sort in page order as text.
 *
 * File managers sort names as strings, where "page-10" lands before "page-2".
 */
export function imageFileNames(stem: string, count: number, format: ImageExportFormat): string[] {
  const digits = Math.max(2, String(count).length);
  const ext = extensionOf(format);
  return Array.from(
    { length: count },
    (_, i) => `${stem}-page-${String(i + 1).padStart(digits, '0')}.${ext}`,
  );
}

/** A file ready to hand to the browser as a download. */
export interface Download {
  fileName: string;
  bytes: Uint8Array;
  mime: string;
}

/**
 * Package page images for download.
 *
 * One page downloads as the image itself. Several go in a zip, because
 * browsers block a burst of separate downloads after the first. PNG and JPEG
 * are already compressed, so the zip stores them rather than deflating them
 * again - which would cost time for no gain.
 */
export function bundleImages(
  stem: string,
  images: readonly Uint8Array[],
  format: ImageExportFormat,
): Download {
  if (images.length === 0) throw new Error('There are no pages to export.');

  if (images.length === 1) {
    return { fileName: `${stem}.${extensionOf(format)}`, bytes: images[0], mime: mimeOf(format) };
  }

  const names = imageFileNames(stem, images.length, format);
  const entries: Record<string, Uint8Array> = {};
  names.forEach((name, i) => {
    entries[name] = images[i];
  });

  return { fileName: `${stem}-pages.zip`, bytes: zipSync(entries, { level: 0 }), mime: 'application/zip' };
}

/** Encode a canvas as image bytes. */
function canvasBytes(canvas: HTMLCanvasElement, format: ImageExportFormat): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('A page could not be encoded.'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      mimeOf(format),
      0.92,
    );
  });
}

/**
 * Render every page of a PDF to image bytes.
 *
 * Pass the EXPORTED document, not the source: that is what puts every edit in
 * the images. pdf.js applies each page's /Rotate itself, so rotated pages come
 * out upright, exactly as a viewer shows them.
 *
 * Pages are rendered one at a time and each canvas is released straight after
 * encoding; a long document at 300 DPI would otherwise hold every page's pixels
 * at once.
 */
export async function rasterisePdf(
  proxy: PDFDocumentProxy,
  format: ImageExportFormat,
  dpi: number,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];

  for (let i = 1; i <= proxy.numPages; i++) {
    const page = await proxy.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: exportScale(base.width, base.height, dpi) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not acquire a 2D canvas context.');

    // JPEG has no alpha: paint the page white first so nothing composites
    // against black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Print intent, not the default display intent: pdf.js paces display
    // renders with requestAnimationFrame, which browsers pause in a background
    // tab, so an export left running while the user switched tabs would stall
    // until they came back. Print intent renders straight through - and
    // "as output" is the right meaning for an export anyway.
    await page.render({ canvasContext: context, viewport, intent: 'print' }).promise;
    out.push(await canvasBytes(canvas, format));

    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }

  return out;
}
