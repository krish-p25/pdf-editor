import { describe, it, expect } from 'vitest';
import {
  pointsToScreen,
  screenToPoints,
  rectToScreen,
  displaySize,
  displayToPage,
  pageToDisplay,
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
