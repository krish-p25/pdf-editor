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
