import { describe, it, expect } from 'vitest';
import {
  pointsToScreen,
  screenToPoints,
  rectToScreen,
  displaySize,
  fitWidthZoom,
  displayToPage,
  pageToDisplay,
  rectFromDisplay,
  rectToDisplay,
  rectToPdf,
} from './coords';

describe('scale conversion', () => {
  it('round-trips a value through screen and back', () => {
    expect(screenToPoints(pointsToScreen(100, 1.5), 1.5)).toBeCloseTo(100, 10);
  });

  it('scales a rect', () => {
    expect(rectToScreen({ x: 10, y: 20, width: 30, height: 40 }, 2)).toEqual({
      x: 20,
      y: 40,
      width: 60,
      height: 80,
    });
  });
});

describe('displaySize', () => {
  const page = { width: 600, height: 800 };

  it('leaves dimensions alone at 0 and 180', () => {
    expect(displaySize({ ...page, rotation: 0 })).toEqual({ width: 600, height: 800 });
    expect(displaySize({ ...page, rotation: 180 })).toEqual({ width: 600, height: 800 });
  });

  it('swaps dimensions at 90 and 270', () => {
    expect(displaySize({ ...page, rotation: 90 })).toEqual({ width: 800, height: 600 });
    expect(displaySize({ ...page, rotation: 270 })).toEqual({ width: 800, height: 600 });
  });
});

describe('displayToPage', () => {
  const page = { width: 600, height: 800, rotation: 0 as const };

  it('is identity at rotation 0', () => {
    expect(displayToPage({ x: 10, y: 20 }, page)).toEqual({ x: 10, y: 20 });
  });

  it('maps the display top-left to the page bottom-left at 90', () => {
    // Display is 800x600. Rotating the page 90 degrees clockwise puts the
    // page's bottom-left corner at the display's top-left.
    const p = { ...page, rotation: 90 as const };
    expect(displayToPage({ x: 0, y: 0 }, p)).toEqual({ x: 0, y: 800 });
    expect(displayToPage({ x: 800, y: 0 }, p)).toEqual({ x: 0, y: 0 });
  });

  it('inverts the corners at 180', () => {
    const p = { ...page, rotation: 180 as const };
    expect(displayToPage({ x: 0, y: 0 }, p)).toEqual({ x: 600, y: 800 });
  });

  it('maps correctly at 270', () => {
    const p = { ...page, rotation: 270 as const };
    expect(displayToPage({ x: 0, y: 0 }, p)).toEqual({ x: 600, y: 0 });
  });

  it('round-trips through pageToDisplay at every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const p = { ...page, rotation };
      const original = { x: 137, y: 421 };
      const back = displayToPage(pageToDisplay(original, p), p);
      expect(back.x).toBeCloseTo(original.x, 9);
      expect(back.y).toBeCloseTo(original.y, 9);
    }
  });
});

describe('rectToPdf', () => {
  it('flips y so the rect is anchored at its bottom-left', () => {
    // A 40-tall box whose top is 100 from the page top, on an 800-tall page,
    // has its bottom edge at 800 - 100 - 40 = 660 in PDF coordinates.
    expect(rectToPdf({ x: 50, y: 100, width: 30, height: 40 }, 800)).toEqual({
      x: 50,
      y: 660,
      width: 30,
      height: 40,
    });
  });

  it('round-trips: flipping twice returns the original', () => {
    const r = { x: 5, y: 15, width: 25, height: 35 };
    expect(rectToPdf(rectToPdf(r, 800), 800)).toEqual(r);
  });
});

describe('rect display conversion', () => {
  const r = { x: 10, y: 20, width: 100, height: 50 };
  const page = (rotation: 0 | 90 | 180 | 270) => ({ width: 600, height: 800, rotation });

  it('is the identity on an unrotated page', () => {
    expect(rectToDisplay(r, page(0))).toEqual(r);
  });

  it('swaps width and height on a quarter turn', () => {
    expect(rectToDisplay(r, page(90))).toEqual({ x: 730, y: 10, width: 50, height: 100 });
  });

  it('mirrors on a half turn', () => {
    expect(rectToDisplay(r, page(180))).toEqual({ x: 490, y: 730, width: 100, height: 50 });
  });

  it('round-trips through every rotation', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      expect(rectFromDisplay(rectToDisplay(r, page(rot)), page(rot))).toEqual(r);
    }
  });
});

describe('fitWidthZoom', () => {
  it('fits a page to a phone-width screen', () => {
    // 390px phone, 8px gutter each side, A4-ish 600pt page.
    expect(fitWidthZoom(374, 600)).toBe(0.62);
  });

  it('rounds down, so the page never overflows by a rounding error', () => {
    // 374/600 = 0.6233; rounding to nearest would also give 0.62, but 0.6299
    // would round up to 0.63 and overflow.
    expect(fitWidthZoom(377.94, 600)).toBe(0.62);
    expect(600 * fitWidthZoom(377.94, 600)).toBeLessThanOrEqual(377.94);
  });

  it('uses the width the page is shown at, so a rotated page fits too', () => {
    expect(fitWidthZoom(400, 800)).toBe(0.5);
  });

  it('stays within the editor zoom range', () => {
    expect(fitWidthZoom(50, 600)).toBe(0.25);
    expect(fitWidthZoom(10000, 600)).toBe(4);
  });

  it('falls back to 100% before anything has a size', () => {
    expect(fitWidthZoom(0, 600)).toBe(1);
    expect(fitWidthZoom(400, 0)).toBe(1);
  });
});
