import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMetrics, layoutText, lineX, type FontMetrics } from './fontMetrics';

let m: FontMetrics;

beforeAll(() => {
  m = createMetrics(new Uint8Array(readFileSync('public/fonts/Inter-Regular.ttf')));
});

describe('measureText', () => {
  it('matches pdf-lib by summing raw advances, not kerned advances', () => {
    // Verified against pdf-lib widthOfTextAtSize. The KERNED values are
    // 115.8750 and 54.4453 respectively, so if this test fails, measureText
    // has been changed to use layout().advanceWidth and preview/export will
    // silently drift apart.
    expect(m.measureText('The quick brown fox', 12)).toBeCloseTo(116.9121, 3);
    expect(m.measureText('AV Wa To', 12)).toBeCloseTo(56.8125, 3);
  });

  it('returns 0 for an empty string', () => {
    expect(m.measureText('', 12)).toBe(0);
  });

  it('scales linearly with font size', () => {
    expect(m.measureText('Hello', 24)).toBeCloseTo(m.measureText('Hello', 12) * 2, 6);
  });
});

describe('layoutText', () => {
  it('keeps text on one line when it fits', () => {
    const r = layoutText(m, 'Hello world', 12, 500, 1.2);
    expect(r.lines.map((l) => l.text)).toEqual(['Hello world']);
  });

  it('wraps at word boundaries when it does not fit', () => {
    const r = layoutText(m, 'The quick brown fox', 12, 60, 1.2);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const line of r.lines) expect(line.width).toBeLessThanOrEqual(60);
  });

  it('honours explicit newlines', () => {
    const r = layoutText(m, 'one\ntwo', 12, 500, 1.2);
    expect(r.lines.map((l) => l.text)).toEqual(['one', 'two']);
  });

  it('breaks a single unbreakable word that exceeds the width', () => {
    const r = layoutText(m, 'AAAAAAAAAAAAAAAAAAAA', 12, 30, 1.2);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const line of r.lines) expect(line.width).toBeLessThanOrEqual(30);
  });

  it('produces one empty line for empty input so the caret has a home', () => {
    const r = layoutText(m, '', 12, 100, 1.2);
    expect(r.lines).toEqual([{ text: '', width: 0 }]);
    expect(r.height).toBeCloseTo(12 * 1.2, 6);
  });

  it('computes height as line count times line height', () => {
    const r = layoutText(m, 'a\nb\nc', 10, 500, 1.5);
    expect(r.height).toBeCloseTo(3 * 15, 6);
  });

  it('places the baseline inside the line box', () => {
    const r = layoutText(m, 'Hello', 12, 500, 1.4);
    expect(r.baselineOffset).toBeGreaterThan(0);
    expect(r.baselineOffset).toBeLessThan(r.lineBoxHeight);
  });
});

describe('lineX', () => {
  it('offsets lines for centre and right alignment', () => {
    const r = layoutText(m, 'ab', 12, 200, 1.2);
    const w = r.lines[0].width;
    expect(lineX(r, 0, 'left', 200)).toBeCloseTo(0, 6);
    expect(lineX(r, 0, 'center', 200)).toBeCloseTo((200 - w) / 2, 6);
    expect(lineX(r, 0, 'right', 200)).toBeCloseTo(200 - w, 6);
  });
});
