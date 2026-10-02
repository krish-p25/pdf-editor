import type { Crop, Rect } from '../model/types';
import type { Point } from './lines';

export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 };

/** Smallest crop we allow, as a fraction. Stops a drag collapsing it to nothing. */
const MIN_CROP = 0.02;

/** Scale an image down to fit a box, preserving its aspect ratio. */
export function fitWithin(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  // A degenerate image would otherwise produce NaN or a zero-sized object the
  // user could never grab again.
  const w = naturalWidth > 0 ? naturalWidth : 1;
  const h = naturalHeight > 0 ? naturalHeight : 1;

  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  return { width: w * scale, height: h * scale };
}

/** Pull a crop back inside the image and stop it collapsing. */
export function clampCrop(crop: Crop): Crop {
  const width = Math.min(1, Math.max(MIN_CROP, crop.width));
  const height = Math.min(1, Math.max(MIN_CROP, crop.height));
  return {
    width,
    height,
    x: Math.min(1 - width, Math.max(0, crop.x)),
    y: Math.min(1 - height, Math.max(0, crop.y)),
  };
}

/**
 * The crop as a whole-pixel region of the source image.
 *
 * Rounded because this feeds `drawImage` on a canvas, which cannot take a
 * fractional source rectangle, and floored to at least one pixel so a tiny
 * crop still produces a drawable region rather than an empty canvas.
 */
export function cropPixels(crop: Crop, naturalWidth: number, naturalHeight: number): Rect {
  const c = clampCrop(crop);
  return {
    x: Math.round(c.x * naturalWidth),
    y: Math.round(c.y * naturalHeight),
    width: Math.max(1, Math.round(c.width * naturalWidth)),
    height: Math.max(1, Math.round(c.height * naturalHeight)),
  };
}

/**
 * Position a box so it is centred on `centre` but stays on the page.
 *
 * Dropping near an edge would otherwise leave most of the image hanging off
 * the page, where it is both invisible and awkward to drag back. A box larger
 * than the page is pinned to the top-left rather than given a negative
 * offset, so at least its origin is reachable.
 */
export function placeAtPoint(
  width: number,
  height: number,
  centre: Point,
  page: { width: number; height: number },
): { x: number; y: number } {
  const x = centre.x - width / 2;
  const y = centre.y - height / 2;
  return {
    x: Math.max(0, Math.min(x, page.width - width)),
    y: Math.max(0, Math.min(y, page.height - height)),
  };
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * Resize a rect towards `point` while holding `aspect` (width / height).
 *
 * The corner opposite the dragged handle stays put, which is what makes the
 * image feel anchored rather than sliding around as it scales.
 */
export function preserveAspect(
  origin: Rect,
  handle: ResizeHandle,
  point: Point,
  aspect: number,
): Rect {
  const ratio = aspect > 0 ? aspect : 1;

  // The fixed corner is the one diagonally opposite the handle.
  const anchorX = handle.includes('w') ? origin.x + origin.width : origin.x;
  const anchorY = handle.includes('n') ? origin.y + origin.height : origin.y;

  const rawWidth = Math.abs(point.x - anchorX);
  const rawHeight = Math.abs(point.y - anchorY);

  // Drive from whichever axis the pointer moved further along, so the image
  // tracks the cursor instead of fighting it.
  const width = Math.max(4, rawWidth > rawHeight * ratio ? rawWidth : rawHeight * ratio);
  const height = width / ratio;

  return {
    width,
    height,
    x: handle.includes('w') ? anchorX - width : anchorX,
    y: handle.includes('n') ? anchorY - height : anchorY,
  };
}

export interface DrawAnchor {
  x: number;
  y: number;
  /** Angle to pass to pdf-lib, in PDF's anticlockwise degrees. */
  degrees: number;
}

/**
 * Where to anchor a rotated image so it ends up centred on `centre`.
 *
 * pdf-lib rotates `drawImage` about the x/y it is given — the bottom-left
 * corner — but a user rotating an image expects it to spin about its middle.
 * This walks half the diagonal backwards through the rotation to find the
 * corner that puts the centre where it belongs.
 *
 * Angles are stored clockwise to match CSS; PDF measures anticlockwise, so the
 * sign flips on the way out.
 */
export function rotatedDrawAnchor(
  centre: Point,
  width: number,
  height: number,
  degreesClockwise: number,
): DrawAnchor {
  const degrees = -(((degreesClockwise % 360) + 360) % 360);
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const halfW = width / 2;
  const halfH = height / 2;

  return {
    x: centre.x - halfW * cos + halfH * sin,
    y: centre.y - halfW * sin - halfH * cos,
    degrees: degrees === -0 ? 0 : degrees,
  };
}
