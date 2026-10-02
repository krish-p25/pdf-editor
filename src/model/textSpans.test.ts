import { describe, it, expect } from 'vitest';
import {
  applySpanStyle,
  clearSpanKey,
  defaultStyleOf,
  diffEdit,
  normaliseSpans,
  rangeStyle,
  remapSpans,
  resolveChars,
  styleAt,
  type ResolvedStyle,
} from './textSpans';
import type { StyleSpan, TextObject } from './types';

const base: ResolvedStyle = { bold: false, italic: false, color: '#111111', fontSize: 14 };

const textObject = (over: Partial<TextObject> = {}): TextObject => ({
  id: 't1',
  pageId: 'p1',
  kind: 'text',
  x: 0,
  y: 0,
  width: 200,
  height: 20,
  text: 'Hello world',
  fontSize: 14,
  color: '#111111',
  bold: false,
  italic: false,
  align: 'left',
  lineHeight: 1.3,
  ...over,
});

/** Spans as a terse tuple, so the expectations stay readable. */
const ranges = (spans: StyleSpan[]) => spans.map((s) => [s.start, s.end] as const);

describe('defaultStyleOf', () => {
  it('reads the box-level styling', () => {
    expect(defaultStyleOf(textObject({ bold: true, fontSize: 22 }))).toEqual({
      bold: true,
      italic: false,
      color: '#111111',
      fontSize: 22,
    });
  });
});

describe('normaliseSpans', () => {
  it('leaves a single tidy span alone', () => {
    const spans: StyleSpan[] = [{ start: 0, end: 5, bold: true }];
    expect(normaliseSpans(spans, 11)).toEqual(spans);
  });

  it('merges adjacent spans that style identically', () => {
    const got = normaliseSpans(
      [
        { start: 0, end: 3, bold: true },
        { start: 3, end: 6, bold: true },
      ],
      11,
    );
    expect(ranges(got)).toEqual([[0, 6]]);
  });

  it('does not merge adjacent spans that differ', () => {
    const got = normaliseSpans(
      [
        { start: 0, end: 3, bold: true },
        { start: 3, end: 6, italic: true },
      ],
      11,
    );
    expect(ranges(got)).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });

  it('sorts spans given out of order', () => {
    const got = normaliseSpans(
      [
        { start: 6, end: 9, bold: true },
        { start: 0, end: 3, italic: true },
      ],
      11,
    );
    expect(ranges(got)).toEqual([
      [0, 3],
      [6, 9],
    ]);
  });

  it('layers overlapping spans instead of letting one replace the other', () => {
    // Bold the first word, then colour part of it: the overlap must be both.
    const got = normaliseSpans(
      [
        { start: 0, end: 6, bold: true },
        { start: 2, end: 4, color: '#ff0000' },
      ],
      11,
    );
    expect(got).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, bold: true, color: '#ff0000' },
      { start: 4, end: 6, bold: true },
    ]);
  });

  it('clips spans to the text and drops ones left empty', () => {
    const got = normaliseSpans(
      [
        { start: 8, end: 40, bold: true },
        { start: 50, end: 60, italic: true },
      ],
      11,
    );
    expect(ranges(got)).toEqual([[8, 11]]);
  });

  it('drops spans that override nothing', () => {
    expect(normaliseSpans([{ start: 0, end: 5 }], 11)).toEqual([]);
  });

  it('drops reversed and zero-length spans', () => {
    expect(normaliseSpans([{ start: 5, end: 5, bold: true }], 11)).toEqual([]);
    expect(normaliseSpans([{ start: 7, end: 2, bold: true }], 11)).toEqual([]);
  });

  it('handles no spans and empty text', () => {
    expect(normaliseSpans(undefined, 11)).toEqual([]);
    expect(normaliseSpans([{ start: 0, end: 5, bold: true }], 0)).toEqual([]);
  });
});

describe('applySpanStyle', () => {
  it('styles only the given range', () => {
    const got = applySpanStyle(undefined, 0, 5, { bold: true }, 11);
    expect(got).toEqual([{ start: 0, end: 5, bold: true }]);
  });

  it('adds a property without disturbing an existing one', () => {
    const got = applySpanStyle([{ start: 0, end: 5, bold: true }], 0, 5, { italic: true }, 11);
    expect(got).toEqual([{ start: 0, end: 5, bold: true, italic: true }]);
  });

  it('splits an existing span when the new range covers part of it', () => {
    const got = applySpanStyle([{ start: 0, end: 6, bold: true }], 2, 4, { color: '#ff0000' }, 11);
    expect(ranges(got)).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
    expect(got[1]).toEqual({ start: 2, end: 4, bold: true, color: '#ff0000' });
  });

  it('turns a style back off over part of a styled range', () => {
    const got = applySpanStyle([{ start: 0, end: 6, bold: true }], 0, 3, { bold: false }, 11);
    expect(got).toEqual([
      { start: 0, end: 3, bold: false },
      { start: 3, end: 6, bold: true },
    ]);
  });

  it('accepts a backwards range, as a right-to-left drag produces', () => {
    expect(applySpanStyle(undefined, 5, 0, { bold: true }, 11)).toEqual([
      { start: 0, end: 5, bold: true },
    ]);
  });

  it('clamps a range that runs past the end of the text', () => {
    expect(ranges(applySpanStyle(undefined, 8, 999, { bold: true }, 11))).toEqual([[8, 11]]);
  });

  it('changes nothing for an empty range', () => {
    expect(applySpanStyle(undefined, 4, 4, { bold: true }, 11)).toEqual([]);
  });
});

describe('clearSpanKey', () => {
  it('removes one property everywhere and keeps the others', () => {
    const got = clearSpanKey(
      [{ start: 0, end: 5, bold: true, italic: true }],
      'bold',
      11,
    );
    expect(got).toEqual([{ start: 0, end: 5, italic: true }]);
  });

  it('drops spans that held nothing else', () => {
    expect(clearSpanKey([{ start: 0, end: 5, bold: true }], 'bold', 11)).toEqual([]);
  });

  it('clears an explicit off-value, so a whole-box style wins', () => {
    // The point of this helper: "make everything bold" must also override the
    // range the user had explicitly un-bolded.
    expect(clearSpanKey([{ start: 2, end: 4, bold: false }], 'bold', 11)).toEqual([]);
  });
});

describe('resolveChars', () => {
  it('gives every character the defaults when there are no spans', () => {
    const got = resolveChars('abc', undefined, base);
    expect(got).toHaveLength(3);
    expect(got.every((s) => s === base)).toBe(true);
  });

  it('overrides only the spanned characters', () => {
    const got = resolveChars('abcdef', [{ start: 1, end: 3, bold: true }], base);
    expect(got.map((s) => s.bold)).toEqual([false, true, true, false, false, false]);
  });

  it('inherits the properties a span does not set', () => {
    const got = resolveChars('ab', [{ start: 0, end: 1, bold: true }], base);
    expect(got[0]).toEqual({ bold: true, italic: false, color: '#111111', fontSize: 14 });
  });

  it('shares one object between characters that style the same', () => {
    // Runs are detected by reference, so identical styling must intern.
    const got = resolveChars('abcd', [{ start: 0, end: 2, bold: true }], base);
    expect(got[0]).toBe(got[1]);
    expect(got[2]).toBe(got[3]);
    expect(got[0]).not.toBe(got[2]);
  });

  it('returns an empty array for empty text', () => {
    expect(resolveChars('', [{ start: 0, end: 3, bold: true }], base)).toEqual([]);
  });
});

describe('styleAt', () => {
  it('reports the styling at an offset', () => {
    expect(styleAt('abcdef', [{ start: 2, end: 4, bold: true }], base, 2).bold).toBe(true);
    expect(styleAt('abcdef', [{ start: 2, end: 4, bold: true }], base, 4).bold).toBe(false);
  });

  it('falls back to the defaults for empty text', () => {
    expect(styleAt('', undefined, base, 0)).toBe(base);
  });

  it('clamps an offset past the end, as a caret at the end gives', () => {
    expect(styleAt('abc', [{ start: 0, end: 3, bold: true }], base, 3).bold).toBe(true);
  });
});

describe('rangeStyle', () => {
  it('reports no mixing across a uniform range', () => {
    const { style, mixed } = rangeStyle('abcdef', [{ start: 0, end: 6, bold: true }], base, 0, 6);
    expect(style.bold).toBe(true);
    expect(mixed.size).toBe(0);
  });

  it('flags the property that differs within the range', () => {
    const { mixed } = rangeStyle('abcdef', [{ start: 0, end: 3, bold: true }], base, 0, 6);
    expect([...mixed]).toEqual(['bold']);
  });

  it('flags each differing property separately', () => {
    const { mixed } = rangeStyle(
      'abcdef',
      [{ start: 0, end: 3, bold: true, fontSize: 20 }],
      base,
      0,
      6,
    );
    expect([...mixed].sort()).toEqual(['bold', 'fontSize']);
  });

  it('reports the caret position when the range is empty', () => {
    const { style, mixed } = rangeStyle('abcdef', [{ start: 2, end: 4, bold: true }], base, 3, 3);
    expect(style.bold).toBe(true);
    expect(mixed.size).toBe(0);
  });
});

describe('diffEdit', () => {
  it('describes a character typed at the end', () => {
    expect(diffEdit('abc', 'abcd')).toEqual({ at: 3, removed: 0, inserted: 1 });
  });

  it('describes a character typed in the middle', () => {
    expect(diffEdit('abc', 'abXc')).toEqual({ at: 2, removed: 0, inserted: 1 });
  });

  it('describes a backspace', () => {
    expect(diffEdit('abcd', 'abc')).toEqual({ at: 3, removed: 1, inserted: 0 });
  });

  it('describes a replaced selection', () => {
    expect(diffEdit('abcdef', 'abXYef')).toEqual({ at: 2, removed: 2, inserted: 2 });
  });

  it('describes a paste over a selection', () => {
    expect(diffEdit('abcdef', 'abLONGef')).toEqual({ at: 2, removed: 2, inserted: 4 });
  });

  it('reports no change when nothing changed', () => {
    expect(diffEdit('abc', 'abc')).toEqual({ at: 3, removed: 0, inserted: 0 });
  });

  it('describes clearing the whole text', () => {
    expect(diffEdit('abc', '')).toEqual({ at: 0, removed: 3, inserted: 0 });
  });

  it('does not double-count a repeated character', () => {
    // 'aa' -> 'aaa' is ambiguous about WHERE the insertion happened, but the
    // count has to be right or spans would drift.
    const d = diffEdit('aa', 'aaa');
    expect(d.removed).toBe(0);
    expect(d.inserted).toBe(1);
  });
});

describe('remapSpans', () => {
  it('shifts a span right when text is inserted before it', () => {
    const got = remapSpans([{ start: 4, end: 8, bold: true }], 'abcdefgh', 'XXabcdefgh');
    expect(ranges(got)).toEqual([[6, 10]]);
  });

  it('shifts a span left when text is deleted before it', () => {
    const got = remapSpans([{ start: 4, end: 8, bold: true }], 'abcdefgh', 'cdefgh');
    expect(ranges(got)).toEqual([[2, 6]]);
  });

  it('leaves a span alone when the edit is after it', () => {
    const got = remapSpans([{ start: 0, end: 3, bold: true }], 'abcdefgh', 'abcdefghXX');
    expect(ranges(got)).toEqual([[0, 3]]);
  });

  it('grows a span when text is typed inside it', () => {
    const got = remapSpans([{ start: 0, end: 6, bold: true }], 'abcdef', 'abcXXdef');
    expect(ranges(got)).toEqual([[0, 8]]);
    expect(got[0].bold).toBe(true);
  });

  it('shrinks a span when text inside it is deleted', () => {
    const got = remapSpans([{ start: 0, end: 6, bold: true }], 'abcdef', 'abef');
    expect(ranges(got)).toEqual([[0, 4]]);
  });

  it('drops a span whose text was deleted entirely', () => {
    const got = remapSpans([{ start: 2, end: 5, bold: true }], 'abcdefg', 'abfg');
    expect(got).toEqual([]);
  });

  it('keeps several spans in step through one edit', () => {
    const got = remapSpans(
      [
        { start: 0, end: 2, bold: true },
        { start: 6, end: 8, italic: true },
      ],
      'abcdefgh',
      'abXcdefgh',
    );
    expect(ranges(got)).toEqual([
      [0, 2],
      [7, 9],
    ]);
  });

  it('survives the text being cleared', () => {
    expect(remapSpans([{ start: 0, end: 4, bold: true }], 'abcd', '')).toEqual([]);
  });

  it('normalises when the text did not change', () => {
    const got = remapSpans(
      [
        { start: 0, end: 2, bold: true },
        { start: 2, end: 4, bold: true },
      ],
      'abcd',
      'abcd',
    );
    expect(ranges(got)).toEqual([[0, 4]]);
  });
});
