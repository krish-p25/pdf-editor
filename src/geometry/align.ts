import type { Rect } from '../model/types';

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
