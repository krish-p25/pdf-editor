import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMetrics, type FontMetrics } from '../pdf/fontMetrics';
import {
  formatLabel,
  headerLabel,
  labelAnchor,
  labelPdfPlacement,
  measureLabel,
  pageNumberLabel,
} from './pageLabels';
import type { Rotation } from './types';

/** Round numbers, so every expectation below is exact arithmetic. */
const m = { width: 100, ascent: 10, descent: -3 };
const page = (rotation: Rotation) => ({ width: 600, height: 800, rotation });

describe('formatLabel', () => {
  it('numbers pages from one', () => {
    expect(formatLabel('Page {page}', 0, 5)).toBe('Page 1');
  });

  it('fills in the page count', () => {
    expect(formatLabel('Page {page} of {pages}', 2, 5)).toBe('Page 3 of 5');
  });

  it('replaces every occurrence', () => {
    expect(formatLabel('{page}-{page}', 1, 2)).toBe('2-2');
  });

  it('does not mistake {pages} for {page}', () => {
    expect(formatLabel('{pages}', 0, 9)).toBe('9');
  });

  it('leaves plain text alone', () => {
    expect(formatLabel('Confidential', 0, 3)).toBe('Confidential');
  });
});

describe('measureLabel', () => {
  let font: FontMetrics;
  beforeAll(() => {
    font = createMetrics(new Uint8Array(readFileSync('public/fonts/Inter-Regular.ttf')));
  });

  it('measures with the same widths the exporter uses', () => {
    expect(measureLabel(font, 'Page 1', 10).width).toBeCloseTo(font.measureText('Page 1', 10), 10);
  });

  it('reports ascent above and descent below the baseline', () => {
    const got = measureLabel(font, 'Page 1', 10);
    expect(got.ascent).toBeGreaterThan(0);
    expect(got.descent).toBeLessThan(0);
  });
});

describe('labelAnchor', () => {
  const display = { width: 600, height: 800 };

  it('puts a top label one margin plus its ascent below the top', () => {
    expect(labelAnchor({ position: 'top', align: 'left', margin: 20 }, display, m)).toEqual({
      x: 20,
      y: 30,
    });
  });

  it('puts a bottom label so its descent clears the margin', () => {
    expect(labelAnchor({ position: 'bottom', align: 'left', margin: 20 }, display, m)).toEqual({
      x: 20,
      y: 777,
    });
  });

  it('centres', () => {
    expect(labelAnchor({ position: 'bottom', align: 'center', margin: 20 }, display, m).x).toBe(250);
  });

  it('right-aligns against the margin', () => {
    expect(labelAnchor({ position: 'top', align: 'right', margin: 20 }, display, m).x).toBe(480);
  });
});

describe('labelPdfPlacement', () => {
  const label = { position: 'bottom' as const, align: 'center' as const, margin: 20 };

  it('flips into PDF space on an unrotated page', () => {
    expect(labelPdfPlacement(label, page(0), m)).toEqual({ x: 250, y: 23, angle: 0 });
  });

  it('keeps the label at the visual bottom of a page turned 90 degrees', () => {
    // Shown 800x600. The visual bottom is the stored right edge, and the text
    // runs up the page so the viewer's clockwise /Rotate turns it upright.
    expect(labelPdfPlacement(label, page(90), m)).toEqual({ x: 577, y: 350, angle: 90 });
  });

  it('handles a half turn', () => {
    expect(labelPdfPlacement(label, page(180), m)).toEqual({ x: 350, y: 777, angle: 180 });
  });

  it('handles three quarter turns', () => {
    expect(labelPdfPlacement(label, page(270), m)).toEqual({ x: 23, y: 450, angle: 270 });
  });
});

describe('presets', () => {
  it('numbers pages at the bottom centre', () => {
    expect(pageNumberLabel('a')).toMatchObject({
      id: 'a',
      text: 'Page {page} of {pages}',
      position: 'bottom',
      align: 'center',
    });
  });

  it('puts a header top left with the text given', () => {
    expect(headerLabel('b', 'Report')).toMatchObject({
      id: 'b',
      text: 'Report',
      position: 'top',
      align: 'left',
    });
  });
});
