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

/** An image's placement on the page, as cropping needs to know it. */
export interface CropState {
  /** The box the visible part is drawn into, in page space, before rotation. */
  box: Rect;
  crop: Crop;
  /** Clockwise degrees about the box centre, matching CSS. */
  rotation: number;
}

/** Turn a y-down vector clockwise, the way CSS `rotate()` does. */
function rotateClockwise(v: Point, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * Which point of the source image, as fractions 0..1 of it, lies under a page
 * point - accounting for the current crop and for rotation.
 */
export function sourceFraction(state: CropState, p: Point): Point {
  const { box, rotation } = state;
  const crop = clampCrop(state.crop);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Undo the rotation, to get the point in the box's own upright frame.
  const local = rotateClockwise({ x: p.x - centre.x, y: p.y - centre.y }, -rotation);
  const u = (local.x + box.width / 2) / box.width;
  const v = (local.y + box.height / 2) / box.height;

  return { x: crop.x + u * crop.width, y: crop.y + v * crop.height };
}

/**
 * Drag one or two edges of a crop to a point on the source.
 *
 * The opposite edge stays exactly where it is, including when the crop hits
 * its minimum size - clampCrop alone would keep the size by sliding the
 * anchored edge instead.
 */
export function dragCropEdge(crop: Crop, handle: ResizeHandle, at: Point): Crop {
  const c = clampCrop(crop);
  let left = c.x;
  let top = c.y;
  let right = c.x + c.width;
  let bottom = c.y + c.height;

  if (handle.includes('w')) left = Math.min(Math.max(0, at.x), right - MIN_CROP);
  if (handle.includes('e')) right = Math.max(Math.min(1, at.x), left + MIN_CROP);
  if (handle.includes('n')) top = Math.min(Math.max(0, at.y), bottom - MIN_CROP);
  if (handle.includes('s')) bottom = Math.max(Math.min(1, at.y), top + MIN_CROP);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The box an image needs after changing its crop, so that nothing moves.
 *
 * Cropping hides part of an image; it must not rescale what remains. So the
 * frame the whole uncropped source occupies stays fixed - same size, same
 * place - and the box becomes exactly the window `crop` cuts out of it. Every
 * kept pixel stays the same size and on the same spot, and the box shrinks to
 * fit what is left. Resetting the crop is the same operation in reverse: the
 * box grows back to the whole image.
 *
 * A rotated image turns about its box centre, and that centre moves when the
 * box changes, so the new centre is worked out in the image's upright frame
 * and then turned into page space.
 */
export function recrop(state: CropState, next: Crop): Rect {
  const { box, rotation } = state;
  const was = clampCrop(state.crop);
  const crop = clampCrop(next);

  // The whole source at the current scale, relative to the box's top-left.
  const fullWidth = box.width / was.width;
  const fullHeight = box.height / was.height;
  const frameX = -was.x * fullWidth;
  const frameY = -was.y * fullHeight;

  const width = crop.width * fullWidth;
  const height = crop.height * fullHeight;

  // Where the new box's centre sits relative to the old one, upright...
  const shift = {
    x: frameX + crop.x * fullWidth + width / 2 - box.width / 2,
    y: frameY + crop.y * fullHeight + height / 2 - box.height / 2,
  };
  // ...and on the page, after the image's rotation.
  const turned = rotateClockwise(shift, rotation);
  const centreX = box.x + box.width / 2 + turned.x;
  const centreY = box.y + box.height / 2 + turned.y;

  return { x: centreX - width / 2, y: centreY - height / 2, width, height };
}

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
