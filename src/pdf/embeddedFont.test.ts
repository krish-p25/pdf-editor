import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { exportPdf, type FontSet } from './exportPdf';
import { createMetrics } from './fontMetrics';
import { embeddedFontReports } from './embeddedFont';
import type { Doc, Page, TextObject } from '../model/types';

/**
 * Regression tests for silently-dropped glyphs.
 *
 * The original pdf-lib's font subsetter corrupted Inter's `glyf`/`loca`
 * tables: 49 of 78 subset glyphs came out with no outline, so exported text
 * had the right position, size and spacing with individual letters simply
 * absent. Every positional test still passed, because the damage was inside
 * the embedded font binary rather than in the text operators.
 */

let source: Uint8Array;
let fonts: FontSet;

const ttf = (name: string) => createMetrics(new Uint8Array(readFileSync(`public/fonts/${name}`)));

beforeAll(() => {
  source = new Uint8Array(readFileSync('src/pdf/__fixtures__/three-pages.pdf'));
  fonts = {
    regular: ttf('Inter-Regular.ttf'),
    bold: ttf('Inter-Bold.ttf'),
    italic: ttf('Inter-Italic.ttf'),
    boldItalic: ttf('Inter-BoldItalic.ttf'),
  };
});

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 .,;:!?()[]{}@#$%&*-+=/';

const page = (objectIds: string[] = []): Page => ({
  id: 'a',
  sourceIndex: 0,
  rotation: 0,
  width: 600,
  height: 800,
  objectIds,
});

const text = (over: Partial<TextObject> = {}): TextObject => ({
  id: 't1',
  pageId: 'a',
  kind: 'text',
  x: 20,
  y: 40,
  width: 560,
  height: 40,
  text: ALPHABET,
  fontSize: 11,
  color: '#000000',
  bold: false,
  italic: false,
  align: 'left',
  lineHeight: 1.3,
  ...over,
});

const doc = (objects: Doc['objects']): Doc => ({
  fileName: 'test.pdf',
  sourceBytes: source,
  pages: [page(Object.keys(objects))],
  objects,
});

/**
 * How many glyphs may legitimately lack an outline.
 *
 * Space is the obvious one; a subset also carries a few non-marking entries.
 * The broken subsetter produced 49 empty glyphs out of 78, so any real
 * regression lands far above this bound.
 */
const MAX_EMPTY_FRACTION = 0.1;

describe('embedded font integrity', () => {
  it('embeds every letter, digit and punctuation mark with a real outline', async () => {
    const out = await exportPdf(doc({ t1: text() }), fonts);
    const reports = await embeddedFontReports(out);

    expect(reports).toHaveLength(1);
    const [r] = reports;

    // The sample has 3 spaces, so a correct subset has very few empty glyphs.
    expect(r.emptyGlyphs.length).toBeLessThanOrEqual(Math.ceil(r.numGlyphs * MAX_EMPTY_FRACTION));
  });

  it('keeps outlines intact for every font variant', async () => {
    const objects: Doc['objects'] = {
      t1: text({ id: 't1', y: 40 }),
      t2: text({ id: 't2', y: 100, bold: true }),
      t3: text({ id: 't3', y: 160, italic: true }),
      t4: text({ id: 't4', y: 220, bold: true, italic: true }),
    };
    const out = await exportPdf(doc(objects), fonts);
    const reports = await embeddedFontReports(out);

    expect(reports).toHaveLength(4);
    for (const r of reports) {
      expect(r.emptyGlyphs.length).toBeLessThanOrEqual(
        Math.ceil(r.numGlyphs * MAX_EMPTY_FRACTION),
      );
    }
  });

  it('subsets rather than embedding the whole 342KB font', async () => {
    // Correctness must not have been bought by disabling subsetting: a full
    // Inter embed is ~2900 glyphs and adds ~180KB per variant.
    const out = await exportPdf(doc({ t1: text() }), fonts);
    const [r] = await embeddedFontReports(out);

    expect(r.numGlyphs).toBeLessThan(200);
    expect(out.byteLength).toBeLessThan(60_000);
  });

  it('embeds accented characters with outlines', async () => {
    const out = await exportPdf(doc({ t1: text({ text: 'café naïve Zürich Łódź' }) }), fonts);
    const [r] = await embeddedFontReports(out);

    expect(r.emptyGlyphs.length).toBeLessThanOrEqual(Math.ceil(r.numGlyphs * MAX_EMPTY_FRACTION));
  });
});
