import fontkit from '@pdf-lib/fontkit';
import type { TextAlign } from '../model/types';

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

export interface LaidOutLine {
  text: string;
  width: number;
}

export interface TextLayout {
  lines: LaidOutLine[];
  /** Height of one line box, in points. */
  lineBoxHeight: number;
  /** Distance from a line box's top to its baseline, in points. */
  baselineOffset: number;
  /** Total height of the laid-out text, in points. */
  height: number;
}

/**
 * Break `text` into lines that fit within `maxWidth`.
 *
 * This is the single source of truth for line breaking. Both the DOM renderer
 * and the PDF exporter consume its output, so the browser is never permitted
 * to make a wrapping decision of its own.
 */
export function layoutText(
  m: FontMetrics,
  text: string,
  fontSize: number,
  maxWidth: number,
  lineHeightMultiplier: number,
): TextLayout {
  const lineBoxHeight = fontSize * lineHeightMultiplier;
  const asc = (m.ascent / m.unitsPerEm) * fontSize;
  const desc = (m.descent / m.unitsPerEm) * fontSize; // negative
  const halfLeading = (lineBoxHeight - (asc - desc)) / 2;

  const lines: LaidOutLine[] = [];
  const push = (t: string) => lines.push({ text: t, width: m.measureText(t, fontSize) });

  /** Hard-break a run that cannot fit even on a line of its own. */
  const breakOversized = (run: string): string => {
    let rest = run;
    while (m.measureText(rest.trimEnd(), fontSize) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && m.measureText(rest.slice(0, cut), fontSize) > maxWidth) cut--;
      push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return rest;
  };

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      push('');
      continue;
    }

    // Keep trailing spaces attached to their word so measured widths stay
    // faithful to what will be drawn.
    const words = paragraph.match(/\S+\s*/g) ?? [];
    let current = '';

    for (const word of words) {
      const candidate = current + word;
      if (current === '' || m.measureText(candidate.trimEnd(), fontSize) <= maxWidth) {
        current = candidate;
      } else {
        push(current.trimEnd());
        current = word;
      }
      current = breakOversized(current);
    }

    push(current.trimEnd());
  }

  if (lines.length === 0) push('');

  return {
    lines,
    lineBoxHeight,
    baselineOffset: halfLeading + asc,
    height: lines.length * lineBoxHeight,
  };
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
