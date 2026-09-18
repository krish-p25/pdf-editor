import type { Rect } from '../model/types';

export interface SnapTarget {
  id: string;
  rect: Rect;
}

export type SnapIndicator =
  | { kind: 'object'; id: string; rect: Rect }
  | { kind: 'page'; axis: 'x' | 'y'; position: number }
  | { kind: 'spacing'; axis: 'x' | 'y'; gaps: Rect[] };

export interface SnapOptions {
  /** In the same units as the rects. Callers convert screen px to points. */
  threshold: number;
  page: { width: number; height: number };
  /** False while Alt is held, so the user can place freely. */
  enabled?: boolean;
}

export interface SnapResult {
  rect: Rect;
  indicators: SnapIndicator[];
}

type Axis = 'x' | 'y';
/** Which of the moving rect's own edges a candidate applies to. */
type Anchor = 0 | 0.5 | 1;

interface Candidate {
  position: number;
  anchor: Anchor;
  indicator: SnapIndicator;
}

const ANCHORS: Anchor[] = [0, 0.5, 1];

function edgesOf(r: Rect, axis: Axis): [number, number, number] {
  return axis === 'x'
    ? [r.x, r.x + r.width / 2, r.x + r.width]
    : [r.y, r.y + r.height / 2, r.y + r.height];
}

/** Alignment lines contributed by other objects and by the page itself. */
function alignmentCandidates(
  axis: Axis,
  targets: SnapTarget[],
  page: { width: number; height: number },
): Candidate[] {
  const out: Candidate[] = [];

  for (const t of targets) {
    const indicator: SnapIndicator = { kind: 'object', id: t.id, rect: t.rect };
    for (const position of edgesOf(t.rect, axis)) {
      for (const anchor of ANCHORS) out.push({ position, anchor, indicator });
    }
  }

  const extent = axis === 'x' ? page.width : page.height;
  for (const position of [0, extent / 2, extent]) {
    const indicator: SnapIndicator = { kind: 'page', axis, position };
    for (const anchor of ANCHORS) out.push({ position, anchor, indicator });
  }

  return out;
}

/**
 * Find a run of three or more targets that are evenly spaced along `axis` and
 * aligned on the perpendicular axis, then offer the position that continues
 * the run with the same gap.
 */
function spacingCandidates(axis: Axis, moving: Rect, targets: SnapTarget[]): Candidate[] {
  const perp: Axis = axis === 'x' ? 'y' : 'x';
  const movingPerpCentre = edgesOf(moving, perp)[1];

  const inLine = targets.filter(
    (t) => Math.abs(edgesOf(t.rect, perp)[1] - movingPerpCentre) < 1,
  );
  if (inLine.length < 2) return [];

  const sorted = [...inLine].sort((a, b) => edgesOf(a.rect, axis)[0] - edgesOf(b.rect, axis)[0]);

  const gaps: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    gaps.push(edgesOf(sorted[i + 1].rect, axis)[0] - edgesOf(sorted[i].rect, axis)[2]);
  }
  if (gaps.length < 2) return [];

  const gap = gaps[0];
  if (gap < 0 || !gaps.every((g) => Math.abs(g - gap) < 0.5)) return [];

  const gapRect = (start: number): Rect =>
    axis === 'x'
      ? { x: start, y: moving.y, width: gap, height: moving.height }
      : { x: moving.x, y: start, width: moving.width, height: gap };

  const existing = sorted.slice(0, -1).map((t) => gapRect(edgesOf(t.rect, axis)[2]));
  const lastEnd = edgesOf(sorted[sorted.length - 1].rect, axis)[2];

  return [
    {
      position: lastEnd + gap,
      anchor: 0,
      indicator: { kind: 'spacing', axis, gaps: [...existing, gapRect(lastEnd)] },
    },
  ];
}

/**
 * Pick the nearest candidate on one axis.
 *
 * All anchor types compete equally: an edge-to-edge alignment does not beat a
 * centre alignment that happens to be closer. Ties keep the first candidate
 * found, and candidates are generated in a fixed order (start, centre, end)
 * so the outcome is deterministic.
 */
function bestForAxis(
  axis: Axis,
  moving: Rect,
  targets: SnapTarget[],
  opts: SnapOptions,
): { offset: number; indicator: SnapIndicator } | null {
  const own = edgesOf(moving, axis);
  const ownAt = (anchor: Anchor) => (anchor === 0 ? own[0] : anchor === 0.5 ? own[1] : own[2]);

  const candidates = [
    ...alignmentCandidates(axis, targets, opts.page),
    ...spacingCandidates(axis, moving, targets),
  ];

  let best: { offset: number; distance: number; indicator: SnapIndicator } | null = null;

  for (const c of candidates) {
    const distance = Math.abs(c.position - ownAt(c.anchor));
    if (distance > opts.threshold) continue;
    if (best && distance >= best.distance) continue;
    best = { offset: c.position - ownAt(c.anchor), distance, indicator: c.indicator };
  }

  return best ? { offset: best.offset, indicator: best.indicator } : null;
}

/**
 * Snap `moving` to nearby objects, page guides and equal-spacing runs.
 *
 * The two axes resolve independently, so an object can snap its left edge to
 * one neighbour and its top edge to a different one in the same drag. Size is
 * never changed — callers that resize pass the resized rect in.
 */
export function resolveSnap(moving: Rect, targets: SnapTarget[], opts: SnapOptions): SnapResult {
  if (opts.enabled === false) return { rect: moving, indicators: [] };

  const x = bestForAxis('x', moving, targets, opts);
  const y = bestForAxis('y', moving, targets, opts);

  const indicators: SnapIndicator[] = [];
  if (x) indicators.push(x.indicator);
  if (y) indicators.push(y.indicator);

  return {
    rect: {
      x: moving.x + (x?.offset ?? 0),
      y: moving.y + (y?.offset ?? 0),
      width: moving.width,
      height: moving.height,
    },
    indicators,
  };
}
