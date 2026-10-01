import { describe, it, expect } from 'vitest';
import { rasterScale } from './renderPage';

// A4 in PDF points.
const A4 = { w: 595, h: 842 };

describe('rasterScale', () => {
  it('supersamples on a non-retina display rather than rendering at 72 DPI', () => {
    // A PDF point is 1px at scale 1, so matching the CSS scale would rasterise
    // an A4 page at 72 DPI and text would look soft next to the vector export.
    expect(rasterScale(1, 1, A4.w, A4.h)).toBe(2);
  });

  it('gives at least 144 DPI at 100% zoom on any display', () => {
    const INCHES_WIDE = A4.w / 72;
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const dpi = (A4.w * rasterScale(1, dpr, A4.w, A4.h)) / INCHES_WIDE;
      expect(dpi).toBeGreaterThanOrEqual(144);
    }
  });

  it('follows the device pixel ratio once it exceeds the supersampling floor', () => {
    expect(rasterScale(1, 3, A4.w, A4.h)).toBe(3);
  });

  it('never renders below the device pixel ratio', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      expect(rasterScale(1, dpr, A4.w, A4.h)).toBeGreaterThanOrEqual(dpr);
    }
  });

  it('maps one bitmap pixel to one physical pixel on a 2x display', () => {
    expect(rasterScale(1, 2, A4.w, A4.h)).toBe(2);
    expect(rasterScale(1.5, 2, A4.w, A4.h)).toBe(3);
  });

  it('scales with zoom', () => {
    expect(rasterScale(2, 2, A4.w, A4.h)).toBe(4);
    expect(rasterScale(2, 1, A4.w, A4.h)).toBe(4);
  });

  it('caps the canvas at 4096px on the long edge', () => {
    // A4 at 400% zoom on a 2x display would want scale 8, i.e. a 4760x6736
    // canvas. The cap is driven by the taller edge.
    const scale = rasterScale(4, 2, A4.w, A4.h);
    expect(scale).toBeLessThan(8);
    expect(A4.h * scale).toBeCloseTo(4096, 6);
    expect(A4.w * scale).toBeLessThanOrEqual(4096);
  });

  it('caps on the wider edge for landscape pages', () => {
    const scale = rasterScale(4, 2, A4.h, A4.w);
    expect(A4.h * scale).toBeCloseTo(4096, 6);
  });

  it('never exceeds the cap on either edge for any input', () => {
    for (const css of [0.25, 1, 2, 4]) {
      for (const dpr of [1, 2, 3]) {
        for (const [w, h] of [
          [595, 842],
          [1224, 792],
          [200, 200],
        ]) {
          const s = rasterScale(css, dpr, w, h);
          expect(w * s).toBeLessThanOrEqual(4096 + 1e-9);
          expect(h * s).toBeLessThanOrEqual(4096 + 1e-9);
        }
      }
    }
  });

  it('does not inflate a small page beyond what was asked for', () => {
    // A small page is nowhere near the cap, so the cap must not raise it.
    expect(rasterScale(1, 2, 200, 200)).toBe(2);
  });

  it('still respects the canvas cap once supersampling is applied', () => {
    // css 4 on a dpr-1 screen now wants 8x, well past the cap.
    const scale = rasterScale(4, 1, A4.w, A4.h);
    expect(scale).toBeLessThan(8);
    expect(A4.h * scale).toBeCloseTo(4096, 6);
  });
});
