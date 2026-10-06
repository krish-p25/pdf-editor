import type { Rect, Rotation } from '../model/types';

export interface Point {
  x: number;
  y: number;
}

export interface PageGeometry {
  width: number;
  height: number;
  rotation: Rotation;
}

export const pointsToScreen = (v: number, scale: number): number => v * scale;
export const screenToPoints = (v: number, scale: number): number => v / scale;

export function rectToScreen(r: Rect, scale: number): Rect {
  return { x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale };
}

export function rectFromScreen(r: Rect, scale: number): Rect {
  return { x: r.x / scale, y: r.y / scale, width: r.width / scale, height: r.height / scale };
}

/**
 * The zoom at which a page of `displayWidth` points fits `availableWidth`
 * pixels, within the editor's 25%-400% range.
 *
 * Rounded DOWN to a whole percent. The store rounds zoom to the nearest
 * percent, which on its own could round up and overflow the screen by a pixel
 * or two; flooring first makes that rounding a no-op.
 */
export function fitWidthZoom(availableWidth: number, displayWidth: number): number {
  if (availableWidth <= 0 || displayWidth <= 0) return 1;
  const fit = Math.floor((availableWidth / displayWidth) * 100) / 100;
  return Math.min(4, Math.max(0.25, fit));
}

/** Size of the page as the user sees it, after rotation. */
export function displaySize(page: PageGeometry): { width: number; height: number } {
  return page.rotation === 90 || page.rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/**
 * Convert a point in display space (what the user sees and clicks: origin
 * top-left, y-down) into unrotated page space (origin top-left, y-down).
 *
 * Objects are stored in unrotated page space, so this is only needed for
 * pointer input that arrives outside the rotated container. Rendering goes the
 * other way via a single CSS rotate() on the page container.
 */
export function displayToPage(p: Point, page: PageGeometry): Point {
  const { width: W, height: H } = page;
  switch (page.rotation) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: p.y, y: H - p.x };
    case 180:
      return { x: W - p.x, y: H - p.y };
    case 270:
      return { x: W - p.y, y: p.x };
  }
}

export function pageToDisplay(p: Point, page: PageGeometry): Point {
  const { width: W, height: H } = page;
  switch (page.rotation) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: H - p.y, y: p.x };
    case 180:
      return { x: W - p.x, y: H - p.y };
    case 270:
      return { x: p.y, y: W - p.x };
  }
}

/** Normalise two opposite corners into a rect. */
function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * A rect in unrotated page space, as it appears on screen.
 *
 * Rotation is always a multiple of 90 degrees, so an axis-aligned rect stays
 * axis-aligned: mapping two opposite corners and normalising is exact.
 */
export function rectToDisplay(r: Rect, page: PageGeometry): Rect {
  return rectFromCorners(
    pageToDisplay({ x: r.x, y: r.y }, page),
    pageToDisplay({ x: r.x + r.width, y: r.y + r.height }, page),
  );
}

/** The inverse of rectToDisplay. */
export function rectFromDisplay(r: Rect, page: PageGeometry): Rect {
  return rectFromCorners(
    displayToPage({ x: r.x, y: r.y }, page),
    displayToPage({ x: r.x + r.width, y: r.y + r.height }, page),
  );
}

/**
 * Convert a rect from unrotated page space (top-left origin, y-down) to PDF
 * user space (bottom-left origin, y-up). Only the anchor moves; width and
 * height are unchanged.
 *
 * This is the ONLY place the y-flip happens. Scattering `pageHeight - y`
 * through the codebase is how objects end up exported upside-down.
 */
export function rectToPdf(r: Rect, pageHeight: number): Rect {
  return { x: r.x, y: pageHeight - r.y - r.height, width: r.width, height: r.height };
}

/** Convert a y coordinate (top-left origin, y-down) to PDF user space. */
export function yToPdf(y: number, pageHeight: number): number {
  return pageHeight - y;
}
