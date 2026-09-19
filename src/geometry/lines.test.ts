import { describe, it, expect } from 'vitest';
import { arrowHead, constrainTo45, endpointsOf, lineFromPoints } from './lines';

describe('lineFromPoints', () => {
  it('derives the bounding box from two points', () => {
    const g = lineFromPoints({ x: 10, y: 20 }, { x: 60, y: 90 });
    expect(g).toMatchObject({ x: 10, y: 20, width: 50, height: 70 });
  });

  it('handles a drag up and to the left', () => {
    const g = lineFromPoints({ x: 60, y: 90 }, { x: 10, y: 20 });
    expect(g).toMatchObject({ x: 10, y: 20, width: 50, height: 70 });
  });

  it('stores endpoints relative to the box, so moving the box moves them', () => {
    const g = lineFromPoints({ x: 10, y: 20 }, { x: 60, y: 90 });
    expect({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }).toEqual({ x1: 0, y1: 0, x2: 50, y2: 70 });
  });

  it('keeps direction when dragging up-right, which the old box model could not', () => {
    // Start bottom-left, end top-right: the end must be the TOP corner.
    const g = lineFromPoints({ x: 10, y: 90 }, { x: 60, y: 20 });
    expect({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }).toEqual({ x1: 0, y1: 70, x2: 50, y2: 0 });
  });

  it('keeps direction when dragging down-right', () => {
    const g = lineFromPoints({ x: 10, y: 20 }, { x: 60, y: 90 });
    expect({ x1: g.y1, y1: g.x1 }).toEqual({ x1: 0, y1: 0 });
    expect({ x2: g.x2, y2: g.y2 }).toEqual({ x2: 50, y2: 70 });
  });

  it('supports a perfectly horizontal line, which the box model forbade', () => {
    const g = lineFromPoints({ x: 10, y: 50 }, { x: 90, y: 50 });
    expect(g.height).toBe(0);
    expect({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }).toEqual({ x1: 0, y1: 0, x2: 80, y2: 0 });
  });

  it('supports a perfectly vertical line', () => {
    const g = lineFromPoints({ x: 50, y: 10 }, { x: 50, y: 90 });
    expect(g.width).toBe(0);
    expect({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }).toEqual({ x1: 0, y1: 0, x2: 0, y2: 80 });
  });

  it('round-trips back to the original absolute points', () => {
    const a = { x: 137, y: 42 };
    const b = { x: 11, y: 260 };
    const { start, end } = endpointsOf(lineFromPoints(a, b));
    expect(start).toEqual(a);
    expect(end).toEqual(b);
  });
});

describe('endpointsOf', () => {
  it('adds the box origin back to the relative endpoints', () => {
    const o = { x: 100, y: 200, x1: 0, y1: 30, x2: 40, y2: 0 };
    expect(endpointsOf(o)).toEqual({
      start: { x: 100, y: 230 },
      end: { x: 140, y: 200 },
    });
  });
});

describe('constrainTo45', () => {
  const a = { x: 100, y: 100 };
  const near = (p: { x: number; y: number }, x: number, y: number) => {
    expect(p.x).toBeCloseTo(x, 6);
    expect(p.y).toBeCloseTo(y, 6);
  };

  it('snaps a nearly-horizontal drag to exactly horizontal', () => {
    // Distance is preserved, so x lands at 100 + hypot(100, 5).
    near(constrainTo45(a, { x: 200, y: 105 }), 100 + Math.hypot(100, 5), 100);
  });

  it('snaps a nearly-vertical drag to exactly vertical', () => {
    const r = constrainTo45(a, { x: 103, y: 200 });
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeGreaterThan(100);
  });

  it('snaps a rough diagonal to exactly 45 degrees', () => {
    const r = constrainTo45(a, { x: 200, y: 190 });
    expect(Math.abs(r.x - a.x)).toBeCloseTo(Math.abs(r.y - a.y), 6);
  });

  it('preserves the drag distance', () => {
    const b = { x: 200, y: 105 };
    const r = constrainTo45(a, b);
    const dragged = Math.hypot(b.x - a.x, b.y - a.y);
    const constrained = Math.hypot(r.x - a.x, r.y - a.y);
    expect(constrained).toBeCloseTo(dragged, 6);
  });

  it('always lands on a multiple of 45 degrees', () => {
    for (const b of [
      { x: 180, y: 130 },
      { x: 40, y: 220 },
      { x: 90, y: 10 },
      { x: 250, y: 99 },
    ]) {
      const r = constrainTo45(a, b);
      const deg = (Math.atan2(r.y - a.y, r.x - a.x) * 180) / Math.PI;
      expect(Math.abs(deg % 45)).toBeLessThan(1e-6);
    }
  });

  it('returns the start point for a zero-length drag', () => {
    expect(constrainTo45(a, a)).toEqual(a);
  });
});

describe('arrowHead', () => {
  it('puts the tip at the end point', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(h.tip).toEqual({ x: 100, y: 0 });
  });

  it('places both barbs behind the tip', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(h.left.x).toBeLessThan(100);
    expect(h.right.x).toBeLessThan(100);
  });

  it('places the barbs symmetrically about the shaft', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(h.left.y).toBeCloseTo(-h.right.y, 6);
  });

  it('stops the shaft short of the tip so a thick stroke does not overshoot', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 12);
    expect(h.shaftEnd.x).toBeCloseTo(88, 6);
    expect(h.shaftEnd.y).toBeCloseTo(0, 6);
  });

  it('rotates with the line direction', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 0, y: 100 }, 10);
    expect(h.tip).toEqual({ x: 0, y: 100 });
    expect(h.shaftEnd.y).toBeCloseTo(90, 6);
    expect(h.shaftEnd.x).toBeCloseTo(0, 6);
  });

  it('degrades safely for a zero-length line', () => {
    const h = arrowHead({ x: 50, y: 50 }, { x: 50, y: 50 }, 10);
    expect(Number.isFinite(h.left.x)).toBe(true);
    expect(Number.isFinite(h.right.y)).toBe(true);
  });
});
