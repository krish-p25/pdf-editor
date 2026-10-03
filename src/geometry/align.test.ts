import { describe, it, expect } from 'vitest';
import { alignRects, boundsOf, distributeRects } from './align';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('boundsOf', () => {
  it('encloses every rect', () => {
    expect(boundsOf([rect(10, 20, 30, 40), rect(50, 5, 10, 10)])).toEqual(rect(10, 5, 50, 55));
  });
});

describe('alignRects', () => {
  const target = rect(100, 200, 300, 400);
  const r = rect(0, 0, 50, 20);

  it('aligns left edges', () => {
    expect(alignRects([r], 'left', target)[0]).toEqual(rect(100, 0, 50, 20));
  });

  it('centres horizontally', () => {
    expect(alignRects([r], 'hcenter', target)[0].x).toBe(225);
  });

  it('aligns right edges', () => {
    expect(alignRects([r], 'right', target)[0].x).toBe(350);
  });

  it('aligns top edges', () => {
    expect(alignRects([r], 'top', target)[0]).toEqual(rect(0, 200, 50, 20));
  });

  it('centres vertically', () => {
    expect(alignRects([r], 'vcenter', target)[0].y).toBe(390);
  });

  it('aligns bottom edges', () => {
    expect(alignRects([r], 'bottom', target)[0].y).toBe(580);
  });

  it('only moves along the axis being aligned', () => {
    const moved = alignRects([rect(7, 9, 50, 20)], 'left', target)[0];
    expect(moved.y).toBe(9);
    expect(moved.width).toBe(50);
    expect(moved.height).toBe(20);
  });

  it('does not change the rects it was given', () => {
    const input = [rect(7, 9, 50, 20)];
    alignRects(input, 'left', target);
    expect(input[0].x).toBe(7);
  });
});

describe('distributeRects', () => {
  it('equalises the gaps, keeping the overall extent', () => {
    // Bounds 0..100, widths total 40, so each of the two gaps is 30.
    const got = distributeRects([rect(0, 0, 10, 5), rect(15, 0, 20, 5), rect(90, 0, 10, 5)], 'horizontal');
    expect(got.map((g) => g.x)).toEqual([0, 40, 90]);
  });

  it('returns results in the order the rects were given', () => {
    const got = distributeRects([rect(90, 0, 10, 5), rect(0, 0, 10, 5), rect(15, 0, 20, 5)], 'horizontal');
    expect(got.map((g) => g.x)).toEqual([90, 0, 40]);
  });

  it('works vertically', () => {
    const got = distributeRects([rect(0, 0, 5, 10), rect(0, 15, 5, 20), rect(0, 90, 5, 10)], 'vertical');
    expect(got.map((g) => g.y)).toEqual([0, 40, 90]);
  });

  it('leaves fewer than three rects where they are', () => {
    const input = [rect(0, 0, 10, 5), rect(50, 0, 10, 5)];
    expect(distributeRects(input, 'horizontal')).toEqual(input);
  });

  it('does not change the rects it was given', () => {
    const input = [rect(0, 0, 10, 5), rect(15, 0, 20, 5), rect(90, 0, 10, 5)];
    distributeRects(input, 'horizontal');
    expect(input[1].x).toBe(15);
  });
});
