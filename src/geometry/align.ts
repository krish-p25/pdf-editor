import type { Rect } from '../model/types';
import { displaySize, rectFromDisplay, rectToDisplay, type PageGeometry } from './coords';

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** The smallest rect enclosing all of them. */
export function boundsOf(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Line each rect up against one edge or centre line of `target`. */
export function alignRects(rects: readonly Rect[], edge: AlignEdge, target: Rect): Rect[] {
  return rects.map((r) => {
    switch (edge) {
      case 'left':
        return { ...r, x: target.x };
      case 'hcenter':
        return { ...r, x: target.x + (target.width - r.width) / 2 };
      case 'right':
        return { ...r, x: target.x + target.width - r.width };
      case 'top':
        return { ...r, y: target.y };
      case 'vcenter':
        return { ...r, y: target.y + (target.height - r.height) / 2 };
      case 'bottom':
        return { ...r, y: target.y + target.height - r.height };
    }
  });
}

/**
 * Space rects evenly along one axis.
 *
 * The selection keeps its overall extent - its first and last edges stay put -
 * and the gaps between neighbours are made equal, taking them in order of
 * position. Results come back in the order the rects were given.
 */
export function distributeRects(rects: readonly Rect[], axis: DistributeAxis): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  if (rects.length < 3) return out;

  const pos = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';

  const bounds = boundsOf(rects);
  const start = bounds[pos];
  const span = bounds[size];
  const occupied = rects.reduce((sum, r) => sum + r[size], 0);
  const gap = (span - occupied) / (rects.length - 1);

  const order = rects.map((_, i) => i).sort((a, b) => rects[a][pos] - rects[b][pos]);
  let cursor = start;
  for (const i of order) {
    out[i][pos] = cursor;
    cursor += rects[i][size] + gap;
  }
  return out;
}

/**
 * Align objects on a page as the user sees it.
 *
 * Objects are stored in unrotated page space, but "left" means the left of the
 * page on screen. Converting to display space, aligning there and converting
 * back gets every rotation right without special-casing any of them.
 *
 * Several objects align to their combined bounds; a single object aligns to
 * the page.
 */
export function alignOnPage(rects: readonly Rect[], edge: AlignEdge, page: PageGeometry): Rect[] {
  const shown = rects.map((r) => rectToDisplay(r, page));
  const display = displaySize(page);
  const target =
    rects.length === 1
      ? { x: 0, y: 0, width: display.width, height: display.height }
      : boundsOf(shown);
  return alignRects(shown, edge, target).map((r) => rectFromDisplay(r, page));
}

/** Distribute objects along an axis of the page as the user sees it. */
export function distributeOnPage(
  rects: readonly Rect[],
  axis: DistributeAxis,
  page: PageGeometry,
): Rect[] {
  return distributeRects(
    rects.map((r) => rectToDisplay(r, page)),
    axis,
  ).map((r) => rectFromDisplay(r, page));
}
