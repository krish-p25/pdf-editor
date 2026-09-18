import { describe, it, expect } from 'vitest';
import { resolveSnap, type SnapTarget } from './snapping';
import type { Rect } from '../model/types';

const page = { width: 600, height: 800 };
const opts = { threshold: 6, page };
const targets = (...rects: SnapTarget[]): SnapTarget[] => rects;

/**
 * Note on the geometry in these tests: every alignment line competes equally,
 * so a centre-to-centre alignment beats an edge-to-edge one if it is nearer.
 * Where a test means to assert an edge snap, the moving rect is given the same
 * size as its target so edge and centre distances tie, and the fixed candidate
 * order (start, centre, end) resolves it. Sizes here are deliberate.
 */

describe('object snapping', () => {
  const other = targets({ id: 'a', rect: { x: 100, y: 100, width: 50, height: 50 } });

  it('snaps a left edge to another object left edge', () => {
    const moving: Rect = { x: 103, y: 300, width: 50, height: 50 };
    const r = resolveSnap(moving, other, opts);
    expect(r.rect.x).toBe(100);
    expect(r.indicators.some((i) => i.kind === 'object' && i.id === 'a')).toBe(true);
  });

  it('does not snap beyond the threshold', () => {
    const moving: Rect = { x: 200, y: 300, width: 50, height: 50 };
    expect(resolveSnap(moving, other, opts).rect.x).toBe(200);
  });

  it('snaps the two axes independently to different objects', () => {
    const two = targets(
      { id: 'a', rect: { x: 100, y: 500, width: 50, height: 50 } },
      { id: 'b', rect: { x: 400, y: 200, width: 50, height: 50 } },
    );
    const moving: Rect = { x: 102, y: 203, width: 50, height: 50 };
    const r = resolveSnap(moving, two, opts);
    expect(r.rect.x).toBe(100); // from a
    expect(r.rect.y).toBe(200); // from b
  });

  it('prefers the nearest candidate when several are in range', () => {
    const two = targets(
      { id: 'a', rect: { x: 100, y: 300, width: 50, height: 50 } },
      { id: 'b', rect: { x: 104, y: 300, width: 50, height: 50 } },
    );
    const moving: Rect = { x: 103, y: 600, width: 50, height: 50 };
    expect(resolveSnap(moving, two, opts).rect.x).toBe(104);
  });

  it('snaps centre to centre when that is the nearest alignment', () => {
    const wide = targets({ id: 'a', rect: { x: 100, y: 100, width: 100, height: 50 } });
    // Target centre-x is 150; a 40-wide box centres there at x = 130. Its left
    // edge is 28 away from the target's left edge, so centre wins on distance.
    const moving: Rect = { x: 128, y: 400, width: 40, height: 40 };
    expect(resolveSnap(moving, wide, opts).rect.x).toBe(130);
  });

  it('leaves width and height untouched', () => {
    const moving: Rect = { x: 103, y: 103, width: 40, height: 40 };
    const r = resolveSnap(moving, other, opts);
    expect(r.rect.width).toBe(40);
    expect(r.rect.height).toBe(40);
  });
});

describe('page guides', () => {
  it('snaps to the page horizontal centre', () => {
    // Page centre-x is 300; a 40-wide box centres there at x = 280.
    const moving: Rect = { x: 283, y: 400, width: 40, height: 40 };
    const r = resolveSnap(moving, [], opts);
    expect(r.rect.x).toBe(280);
    expect(r.indicators.some((i) => i.kind === 'page')).toBe(true);
  });

  it('snaps to the page left edge', () => {
    const moving: Rect = { x: 3, y: 400, width: 40, height: 40 };
    expect(resolveSnap(moving, [], opts).rect.x).toBe(0);
  });
});

describe('equal spacing', () => {
  it('continues an evenly spaced run', () => {
    // Three 20-wide boxes at x = 0, 50, 100 leave a gap of 30 between each.
    // A fourth box continues the run at x = 150.
    const run = targets(
      { id: 'a', rect: { x: 0, y: 100, width: 20, height: 20 } },
      { id: 'b', rect: { x: 50, y: 100, width: 20, height: 20 } },
      { id: 'c', rect: { x: 100, y: 100, width: 20, height: 20 } },
    );
    const moving: Rect = { x: 152, y: 100, width: 20, height: 20 };
    const r = resolveSnap(moving, run, opts);
    expect(r.rect.x).toBe(150);
    expect(r.indicators.some((i) => i.kind === 'spacing')).toBe(true);
  });

  it('does not offer spacing when the gaps are uneven', () => {
    const run = targets(
      { id: 'a', rect: { x: 0, y: 100, width: 20, height: 20 } },
      { id: 'b', rect: { x: 50, y: 100, width: 20, height: 20 } },
      { id: 'c', rect: { x: 130, y: 100, width: 20, height: 20 } },
    );
    const moving: Rect = { x: 210, y: 100, width: 20, height: 20 };
    const r = resolveSnap(moving, run, opts);
    expect(r.indicators.some((i) => i.kind === 'spacing')).toBe(false);
  });

  it('ignores objects that are not aligned on the perpendicular axis', () => {
    const run = targets(
      { id: 'a', rect: { x: 0, y: 100, width: 20, height: 20 } },
      { id: 'b', rect: { x: 50, y: 400, width: 20, height: 20 } },
      { id: 'c', rect: { x: 100, y: 700, width: 20, height: 20 } },
    );
    const moving: Rect = { x: 152, y: 100, width: 20, height: 20 };
    const r = resolveSnap(moving, run, opts);
    expect(r.indicators.some((i) => i.kind === 'spacing')).toBe(false);
  });
});

describe('suppression', () => {
  it('returns the rect untouched when disabled', () => {
    const other = targets({ id: 'a', rect: { x: 100, y: 100, width: 50, height: 50 } });
    const moving: Rect = { x: 103, y: 103, width: 40, height: 40 };
    const r = resolveSnap(moving, other, { ...opts, enabled: false });
    expect(r.rect).toEqual(moving);
    expect(r.indicators).toEqual([]);
  });
});

describe('threshold scaling', () => {
  it('uses the supplied threshold, so callers can convert screen px to points', () => {
    const other = targets({ id: 'a', rect: { x: 100, y: 100, width: 50, height: 50 } });
    // 10 points away: outside a 6pt threshold, inside a 12pt one.
    const moving: Rect = { x: 110, y: 300, width: 50, height: 50 };
    expect(resolveSnap(moving, other, { ...opts, threshold: 6 }).rect.x).toBe(110);
    expect(resolveSnap(moving, other, { ...opts, threshold: 12 }).rect.x).toBe(100);
  });
});
