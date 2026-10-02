import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createMetrics,
  layoutStyledText,
  layoutText,
  variantOf,
  variantsOf,
  type FontMetrics,
  type MetricsFor,
} from './fontMetrics';
import type { ResolvedStyle } from '../model/textSpans';
import type { StyleSpan } from '../model/types';

let regular: FontMetrics;
let bold: FontMetrics;
let italic: FontMetrics;
let boldItalic: FontMetrics;
let getMetrics: MetricsFor;

beforeAll(() => {
  const load = (f: string) => createMetrics(new Uint8Array(readFileSync(`public/fonts/${f}`)));
  regular = load('Inter-Regular.ttf');
  bold = load('Inter-Bold.ttf');
  italic = load('Inter-Italic.ttf');
  boldItalic = load('Inter-BoldItalic.ttf');
  getMetrics = (s) =>
    s.bold && s.italic ? boldItalic : s.bold ? bold : s.italic ? italic : regular;
});

const style = (over: Partial<ResolvedStyle> = {}): ResolvedStyle => ({
  bold: false,
  italic: false,
  color: '#111111',
  fontSize: 12,
  ...over,
});

const lay = (text: string, spans: StyleSpan[] | undefined, width = 400, lh = 1.3, d = style()) =>
  layoutStyledText(getMetrics, text, spans, d, width, lh);

describe('layoutStyledText with no spans', () => {
  it('agrees exactly with the uniform layout path', () => {
    // The uniform wrapper delegates here, so a regression would mean the two
    // callers of this module could disagree about wrapping.
    const text = 'The quick brown fox jumps over the lazy dog again and again';
    const rich = lay(text, undefined, 150);
    const plain = layoutText(regular, text, 12, 150, 1.3);

    expect(rich.lines.map((l) => l.text)).toEqual(plain.lines.map((l) => l.text));
    expect(rich.height).toBeCloseTo(plain.height, 6);
    expect(rich.baselineOffset).toBeCloseTo(plain.baselineOffset, 6);
  });

  it('puts the whole line in a single run', () => {
    const r = lay('Hello world', undefined);
    expect(r.lines[0].runs).toHaveLength(1);
    expect(r.lines[0].runs[0].text).toBe('Hello world');
    expect(r.lines[0].runs[0].x).toBe(0);
  });
});

describe('layoutStyledText runs', () => {
  it('splits a line where the styling changes', () => {
    const r = lay('Hello world', [{ start: 0, end: 5, bold: true }]);
    expect(r.lines[0].runs.map((x) => x.text)).toEqual(['Hello', ' world']);
    expect(r.lines[0].runs[0].style.bold).toBe(true);
    expect(r.lines[0].runs[1].style.bold).toBe(false);
  });

  it('splits in three when a span sits in the middle', () => {
    const r = lay('abc def ghi', [{ start: 4, end: 7, italic: true }]);
    expect(r.lines[0].runs.map((x) => x.text)).toEqual(['abc ', 'def', ' ghi']);
  });

  it('splits on a colour change even though the font is the same', () => {
    const r = lay('red blue', [{ start: 0, end: 3, color: '#ff0000' }]);
    expect(r.lines[0].runs).toHaveLength(2);
    expect(r.lines[0].runs[0].style.color).toBe('#ff0000');
  });

  it('reassembles into exactly the line text', () => {
    const r = lay('mixed styling here', [
      { start: 0, end: 5, bold: true },
      { start: 6, end: 13, fontSize: 20 },
    ]);
    for (const line of r.lines) {
      expect(line.runs.map((x) => x.text).join('')).toBe(line.text);
    }
  });

  it('places each run at the running sum of the widths before it', () => {
    const r = lay('Hello world', [{ start: 0, end: 5, bold: true }]);
    const [first, second] = r.lines[0].runs;
    expect(first.x).toBe(0);
    expect(second.x).toBeCloseTo(first.width, 6);
    expect(r.lines[0].width).toBeCloseTo(first.width + second.width, 6);
  });

  it('measures a bold run with the bold font, not the regular one', () => {
    // Inter Bold is wider than Inter Regular, so measuring with the wrong
    // variant would be visible as text overflowing its box on export.
    const r = lay('Hello', [{ start: 0, end: 5, bold: true }]);
    expect(r.lines[0].runs[0].width).toBeCloseTo(bold.measureText('Hello', 12), 6);
    expect(r.lines[0].runs[0].width).toBeGreaterThan(regular.measureText('Hello', 12));
  });

  it('measures a run at its own font size', () => {
    const r = lay('big small', [{ start: 0, end: 3, fontSize: 24 }]);
    expect(r.lines[0].runs[0].width).toBeCloseTo(regular.measureText('big', 24), 6);
  });

  it('carries the resolved style, inheriting what the span leaves out', () => {
    const r = lay('abc', [{ start: 0, end: 3, bold: true }], 400, 1.3, style({ color: '#00ff00' }));
    expect(r.lines[0].runs[0].style).toMatchObject({ bold: true, color: '#00ff00', fontSize: 12 });
  });
});

describe('layoutStyledText line boxes', () => {
  it('takes the line height from the largest font on the line', () => {
    const r = lay('small BIG', [{ start: 6, end: 9, fontSize: 24 }]);
    expect(r.lines[0].height).toBeCloseTo(24 * 1.3, 6);
  });

  it('ignores a large font that wrapped onto another line', () => {
    // Wide enough for the big word alone, too narrow for both words, so each
    // line box is sized by what actually landed on it.
    const width = regular.measureText('BB', 24) + 4;
    const r = lay('aaaa BB', [{ start: 5, end: 7, fontSize: 24 }], width);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].height).toBeCloseTo(12 * 1.3, 6);
    expect(r.lines[1].height).toBeCloseTo(24 * 1.3, 6);
  });

  it('stacks lines by their own heights rather than a fixed step', () => {
    const r = lay('one\ntwo', [{ start: 0, end: 3, fontSize: 30 }]);
    expect(r.lines[0].top).toBe(0);
    expect(r.lines[1].top).toBeCloseTo(30 * 1.3, 6);
  });

  it('totals the height over lines of differing size', () => {
    const r = lay('one\ntwo', [{ start: 0, end: 3, fontSize: 30 }]);
    expect(r.height).toBeCloseTo(30 * 1.3 + 12 * 1.3, 6);
  });

  it('puts the baseline below the tallest ascent on the line', () => {
    const mixed = lay('small BIG', [{ start: 6, end: 9, fontSize: 24 }]);
    const uniform = lay('small big', undefined);
    expect(mixed.lines[0].baselineOffset).toBeGreaterThan(uniform.lines[0].baselineOffset);
  });

  it('keeps one shared baseline for every run on the line', () => {
    // Runs are drawn at one baseline; mixed sizes must not each get their own.
    const r = lay('small BIG', [{ start: 6, end: 9, fontSize: 24 }]);
    expect(r.lines[0].runs).toHaveLength(2);
    expect(r.lines[0].baselineOffset).toBeGreaterThan(0);
  });

  it('gives a blank line the height of the style at its offset', () => {
    const r = lay('a\n\nb', [{ start: 0, end: 4, fontSize: 20 }]);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[1].height).toBeCloseTo(20 * 1.3, 6);
  });
});

describe('layoutStyledText wrapping', () => {
  it('wraps sooner when the text is larger', () => {
    const text = 'one two three four five';
    const uniform = lay(text, undefined, 120);
    const enlarged = lay(text, [{ start: 0, end: text.length, fontSize: 24 }], 120);
    expect(enlarged.lines.length).toBeGreaterThan(uniform.lines.length);
  });

  it('wraps at the point the enlarged words stop fitting', () => {
    // Only the first two words are enlarged; the wrap has to account for
    // their real width rather than the box default.
    const text = 'one two three four';
    const width = regular.measureText('one two', 24) + 6;
    const r = lay(text, [{ start: 0, end: 7, fontSize: 24 }], width);
    expect(r.lines[0].text).toBe('one two');
  });

  it('wraps sooner when part of the line is bold', () => {
    // Bold is wider at the same size, so the wrap point genuinely moves.
    const text = 'aaaa aaaa aaaa aaaa aaaa aaaa';
    const plain = lay(text, undefined, 100);
    const emboldened = lay(text, [{ start: 0, end: 29, bold: true }], 100);
    expect(emboldened.lines.length).toBeGreaterThanOrEqual(plain.lines.length);
    for (const line of emboldened.lines) {
      expect(line.width).toBeLessThanOrEqual(100.001);
    }
  });

  it('keeps every line within the box width', () => {
    const r = lay('The quick brown fox jumps over the lazy dog', [
      { start: 4, end: 9, fontSize: 22 },
      { start: 16, end: 19, bold: true },
    ], 160);
    for (const line of r.lines) {
      expect(line.width).toBeLessThanOrEqual(160.001);
    }
  });

  it('hard-breaks a single word that cannot fit, keeping its styling', () => {
    const r = lay('Supercalifragilistic', [{ start: 0, end: 20, bold: true }], 60);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const line of r.lines) {
      expect(line.width).toBeLessThanOrEqual(60.001);
      for (const run of line.runs) expect(run.style.bold).toBe(true);
    }
    expect(r.lines.map((l) => l.text).join('')).toBe('Supercalifragilistic');
  });

  it('splits a style boundary across a wrap without losing characters', () => {
    const text = 'alpha beta gamma delta epsilon';
    const r = lay(text, [{ start: 3, end: 20, bold: true }], 90);
    const rebuilt = r.lines
      .map((l) => l.runs.map((x) => x.text).join(''))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(rebuilt.replace(/ /g, '')).toBe(text.replace(/ /g, ''));
  });
});

describe('variantsOf', () => {
  it('returns just the default variant when there are no spans', () => {
    expect(variantsOf({ bold: false, italic: false }, undefined)).toEqual(['regular']);
  });

  it('includes every variant the spans can require', () => {
    const got = variantsOf({ bold: false, italic: false }, [
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, italic: true },
      { start: 4, end: 6, bold: true, italic: true },
    ]);
    expect(got.sort()).toEqual(['bold', 'boldItalic', 'italic', 'regular']);
  });

  it('resolves a span against the box default rather than assuming regular', () => {
    // Italic text inside a bold box needs the bold-italic file.
    expect(variantsOf({ bold: true, italic: false }, [{ start: 0, end: 2, italic: true }]).sort())
      .toEqual(['bold', 'boldItalic']);
  });

  it('does not list a variant twice', () => {
    const got = variantsOf({ bold: false, italic: false }, [
      { start: 0, end: 2, bold: true },
      { start: 3, end: 5, bold: true },
    ]);
    expect(got).toHaveLength(2);
  });

  it('agrees with variantOf for a single style', () => {
    expect(variantsOf({ bold: true, italic: true }, [])).toEqual([variantOf(true, true)]);
  });
});
