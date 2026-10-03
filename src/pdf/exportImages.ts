import { zipSync } from 'fflate';

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
