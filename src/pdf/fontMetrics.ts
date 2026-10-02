import fontkit from '@cantoo/fontkit';
import { resolveChars, type ResolvedStyle } from '../model/textSpans';
import type { StyleSpan, TextAlign } from '../model/types';

export interface FontMetrics {
  /** Raw font bytes, reused for pdf-lib embedding and the FontFace API. */
  bytes: Uint8Array;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  /**
   * Width of `text` at `fontSize`, as the sum of raw glyph advance widths.
   *
   * This deliberately does NOT use layout().advanceWidth, which applies GPOS
   * kerning. pdf-lib writes a plain glyph string and the viewer advances using
   * the /W widths array, so kerning is never applied in the output. Measuring
   * with kerning would make every wrapped line disagree with the export.
   */
  measureText(text: string, fontSize: number): number;
}

interface FontkitFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  layout(t: string): { glyphs: { advanceWidth: number }[] };
}

export function createMetrics(bytes: Uint8Array): FontMetrics {
  const font = fontkit.create(bytes as never) as unknown as FontkitFont;
  const cache = new Map<string, number>();

  const advanceUnits = (text: string): number => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const g of font.layout(text).glyphs) total += g.advanceWidth;
    // Bound the cache so a long editing session cannot grow it without limit.
    if (cache.size < 5000) cache.set(text, total);
    return total;
  };

  return {
    bytes,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    measureText(text, fontSize) {
      if (text === '') return 0;
      return (advanceUnits(text) / font.unitsPerEm) * fontSize;
    },
  };
}

/**
 * One stretch of characters on a line that shares a single styling.
 *
 * `x` and `ascent` are what let the DOM reproduce the exporter arithmetic
 * instead of approximating it: each run is positioned at its measured offset
 * and lifted so its own baseline lands on the shared baseline of the line.
 */
export interface LaidOutRun {
  text: string;
  /** Offset from the start of the line, in points. */
  x: number;
  width: number;
  style: ResolvedStyle;
  /** Ascent at this run font size, in points. */
  ascent: number;
  /** Descent at this run font size, in points. Negative. */
  descent: number;
}

export interface LaidOutLine {
  text: string;
  width: number;
  /** The styled pieces of this line, left to right. */
  runs: LaidOutRun[];
  /** Top of this line box, relative to the top of the text, in points. */
  top: number;
  /** Height of this line box, in points. Driven by its largest font size. */
  height: number;
  /** Distance from the top of this line box to its baseline, in points. */
  baselineOffset: number;
}

export interface TextLayout {
  lines: LaidOutLine[];
  /** Line box height for the default style of the box, in points. */
  lineBoxHeight: number;
  /** Baseline offset for the default style of the box, in points. */
  baselineOffset: number;
  /** Total height of the laid-out text, in points. */
  height: number;
}

/** Supplies metrics for a styling. Every variant in use must resolve. */
export type MetricsFor = (style: { bold: boolean; italic: boolean }) => FontMetrics;

const ascentOf = (m: FontMetrics, size: number) => (m.ascent / m.unitsPerEm) * size;
const descentOf = (m: FontMetrics, size: number) => (m.descent / m.unitsPerEm) * size;

/**
 * Break styled text into lines that fit within `maxWidth`.
 *
 * This is the single source of truth for line breaking. Both the DOM renderer
 * and the PDF exporter consume its output, so the browser is never permitted
 * to make a wrapping decision of its own.
 *
 * Mixed styling makes measurement per-character rather than per-box: the width
 * of a candidate line is the sum of its runs, each measured with its own
 * variant and size. Line height and baseline come from the largest font on
 * the line, so one big word cannot overlap the line above it.
 */
export function layoutStyledText(
  getMetrics: MetricsFor,
  text: string,
  spans: readonly StyleSpan[] | undefined,
  defaults: ResolvedStyle,
  maxWidth: number,
  lineHeightMultiplier: number,
): TextLayout {
  const chars = resolveChars(text, spans, defaults);
  const styleOf = (i: number): ResolvedStyle => chars[i] ?? defaults;

  /** Walk `[from, to)` as maximal runs of one style; styles are interned. */
  const eachRun = (
    from: number,
    to: number,
    visit: (start: number, end: number, style: ResolvedStyle) => void,
  ): void => {
    let i = from;
    while (i < to) {
      const style = chars[i];
      let j = i + 1;
      while (j < to && chars[j] === style) j++;
      visit(i, j, style);
      i = j;
    }
  };

  const measure = (from: number, to: number): number => {
    let total = 0;
    eachRun(from, to, (a, b, style) => {
      total += getMetrics(style).measureText(text.slice(a, b), style.fontSize);
    });
    return total;
  };

  /** Walk `end` back over trailing whitespace, so measured widths match. */
  const trimmed = (from: number, end: number): number => {
    let e = end;
    while (e > from && /\s/.test(text[e - 1])) e--;
    return e;
  };

  const lines: LaidOutLine[] = [];
  let top = 0;

  const push = (from: number, to: number): void => {
    const runs: LaidOutRun[] = [];
    let x = 0;
    eachRun(from, to, (a, b, style) => {
      const m = getMetrics(style);
      const width = m.measureText(text.slice(a, b), style.fontSize);
      runs.push({
        text: text.slice(a, b),
        x,
        width,
        style,
        ascent: ascentOf(m, style.fontSize),
        descent: descentOf(m, style.fontSize),
      });
      x += width;
    });

    // An empty line still needs a height, taken from the style at its offset
    // so a blank line inside large text keeps the larger spacing.
    const blankStyle = styleOf(from);
    const blankMetrics = getMetrics(blankStyle);
    const height =
      (runs.length > 0 ? Math.max(...runs.map((r) => r.style.fontSize)) : blankStyle.fontSize) *
      lineHeightMultiplier;

    const asc =
      runs.length > 0
        ? Math.max(...runs.map((r) => r.ascent))
        : ascentOf(blankMetrics, blankStyle.fontSize);
    const desc =
      runs.length > 0
        ? Math.min(...runs.map((r) => r.descent))
        : descentOf(blankMetrics, blankStyle.fontSize);

    lines.push({
      text: text.slice(from, to),
      width: x,
      runs,
      top,
      height,
      baselineOffset: (height - (asc - desc)) / 2 + asc,
    });
    top += height;
  };

  /** Hard-break a stretch that cannot fit even on a line of its own. */
  const breakOversized = (from: number, to: number): number => {
    let start = from;
    while (measure(start, trimmed(start, to)) > maxWidth && to - start > 1) {
      let cut = to - start - 1;
      while (cut > 1 && measure(start, start + cut) > maxWidth) cut--;
      push(start, start + cut);
      start += cut;
    }
    return start;
  };

  let paragraphStart = 0;
  for (const paragraph of text.split('\n')) {
    const paragraphEnd = paragraphStart + paragraph.length;

    if (paragraph === '') {
      push(paragraphStart, paragraphStart);
      paragraphStart = paragraphEnd + 1;
      continue;
    }

    // Keep trailing spaces attached to their word so measured widths stay
    // faithful to what will be drawn.
    const words: { start: number; end: number }[] = [];
    const re = /\S+\s*/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(paragraph)) !== null) {
      words.push({
        start: paragraphStart + match.index,
        end: paragraphStart + match.index + match[0].length,
      });
    }

    let lineStart = paragraphStart;
    let lineEnd = paragraphStart;

    for (const word of words) {
      if (lineEnd === lineStart || measure(lineStart, trimmed(lineStart, word.end)) <= maxWidth) {
        lineEnd = word.end;
      } else {
        push(lineStart, trimmed(lineStart, lineEnd));
        lineStart = word.start;
        lineEnd = word.end;
      }
      lineStart = breakOversized(lineStart, lineEnd);
    }

    push(lineStart, trimmed(lineStart, lineEnd));
    paragraphStart = paragraphEnd + 1;
  }

  if (lines.length === 0) push(0, 0);

  const defaultMetrics = getMetrics(defaults);
  const lineBoxHeight = defaults.fontSize * lineHeightMultiplier;
  const dAsc = ascentOf(defaultMetrics, defaults.fontSize);
  const dDesc = descentOf(defaultMetrics, defaults.fontSize);

  return {
    lines,
    lineBoxHeight,
    baselineOffset: (lineBoxHeight - (dAsc - dDesc)) / 2 + dAsc,
    height: lines.reduce((sum, l) => sum + l.height, 0),
  };
}

/**
 * Lay out uniformly styled text.
 *
 * A thin wrapper over the styled path, so the codebase still has exactly one
 * line breaker rather than a simple one and a rich one that could drift apart.
 */
export function layoutText(
  m: FontMetrics,
  text: string,
  fontSize: number,
  maxWidth: number,
  lineHeightMultiplier: number,
): TextLayout {
  return layoutStyledText(
    () => m,
    text,
    undefined,
    { bold: false, italic: false, color: '#000000', fontSize },
    maxWidth,
    lineHeightMultiplier,
  );
}

/** Horizontal offset of line `i` within a box of `boxWidth`, given alignment. */
export function lineX(layout: TextLayout, i: number, align: TextAlign, boxWidth: number): number {
  const w = layout.lines[i].width;
  if (align === 'center') return (boxWidth - w) / 2;
  if (align === 'right') return boxWidth - w;
  return 0;
}

// ─── Browser-side lazy loading ────────────────────────────────────────────

export type FontVariant = 'regular' | 'italic' | 'bold' | 'boldItalic';

export const variantOf = (bold: boolean, italic: boolean): FontVariant =>
  bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';

/**
 * Every variant a styled text object can need.
 *
 * Measurement cannot begin until all of them are loaded, since a bold span is
 * measured with the bold font, so the renderer primes the whole set up front
 * rather than discovering a missing variant mid-layout.
 */
export function variantsOf(
  defaults: { bold: boolean; italic: boolean },
  spans: readonly StyleSpan[] | undefined,
): FontVariant[] {
  const out = new Set<FontVariant>([variantOf(defaults.bold, defaults.italic)]);
  for (const s of spans ?? []) {
    out.add(variantOf(s.bold ?? defaults.bold, s.italic ?? defaults.italic));
  }
  return [...out];
}

const FILES: Record<FontVariant, string> = {
  regular: 'fonts/Inter-Regular.ttf',
  italic: 'fonts/Inter-Italic.ttf',
  bold: 'fonts/Inter-Bold.ttf',
  boldItalic: 'fonts/Inter-BoldItalic.ttf',
};

const loaded = new Map<FontVariant, Promise<FontMetrics>>();
const ready = new Map<FontVariant, FontMetrics>();

/**
 * Fetch a variant's TTF once and use it for three jobs at once: fontkit
 * measurement, the DOM @font-face, and pdf-lib embedding. One download, and
 * the browser renders from the exact file the export embeds.
 */
export function loadFont(variant: FontVariant): Promise<FontMetrics> {
  const existing = loaded.get(variant);
  if (existing) return existing;

  const p = fetch(new URL(FILES[variant], document.baseURI).href).then(async (res) => {
    if (!res.ok) throw new Error(`Failed to load font ${variant}: ${res.status}`);
    const buf = await res.arrayBuffer();

    if (typeof FontFace !== 'undefined') {
      const face = new FontFace('InterPdf', buf, {
        weight: variant === 'bold' || variant === 'boldItalic' ? '700' : '400',
        style: variant === 'italic' || variant === 'boldItalic' ? 'italic' : 'normal',
      });
      await face.load();
      document.fonts.add(face);
    }

    return createMetrics(new Uint8Array(buf));
  });

  loaded.set(variant, p);
  return p;
}

/** Load a variant and record it for synchronous access during render. */
export function primeFont(variant: FontVariant): Promise<FontMetrics> {
  return loadFont(variant).then((m) => {
    ready.set(variant, m);
    return m;
  });
}

export const getLoadedFont = (variant: FontVariant): FontMetrics | undefined => ready.get(variant);
