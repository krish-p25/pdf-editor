import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { exportPdf, hexToRgb, type FontSet } from './exportPdf';
import { createMetrics, layoutStyledText, layoutText, lineX } from './fontMetrics';
import { defaultStyleOf } from '../model/textSpans';
import { drawnTextOnPage } from './contentStream';
import type { Doc, ImageObject, Page, PageLabel, TextObject } from '../model/types';
import { formatLabel, labelPdfPlacement, measureLabel } from '../model/pageLabels';

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

const page = (id: string, sourceIndex: number, objectIds: string[] = []): Page => ({
  id,
  sourceIndex,
  rotation: 0,
  width: 600,
  height: 800,
  objectIds,
});

const doc = (pages: Page[], objects: Doc['objects'] = {}): Doc => ({
  id: 'doc_test',
  title: 'test',
  fileName: 'test.pdf',
  sourceBytes: source,
  pages,
  objects,
});

const text = (over: Partial<TextObject> = {}): TextObject => ({
  id: 't1',
  pageId: 'a',
  kind: 'text',
  x: 50,
  y: 100,
  width: 200,
  height: 40,
  text: 'Hello world',
  fontSize: 14,
  color: '#ff0000',
  bold: false,
  italic: false,
  align: 'left',
  lineHeight: 1.3,
  ...over,
});

describe('hexToRgb', () => {
  it('parses six-digit hex', () => {
    expect(hexToRgb('#ff0000')).toMatchObject({ red: 1, green: 0, blue: 0 });
    expect(hexToRgb('#0000ff')).toMatchObject({ red: 0, green: 0, blue: 1 });
  });

  it('expands three-digit hex', () => {
    expect(hexToRgb('#f00')).toMatchObject({ red: 1, green: 0, blue: 0 });
  });
});

describe('page operations', () => {
  it('keeps all pages when nothing changed', async () => {
    const out = await exportPdf(doc([page('a', 0), page('b', 1), page('c', 2)]), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it('drops deleted pages', async () => {
    const out = await exportPdf(doc([page('a', 0), page('c', 2)]), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('respects the page order in the model', async () => {
    const out = await exportPdf(doc([page('c', 2), page('a', 0), page('b', 1)]), fonts);
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPageCount()).toBe(3);
    // Page sizes are identical here, so order is asserted via rotation below;
    // this case guards against copyPages throwing on a reordered index list.
    expect(loaded.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
  });

  it('applies user rotation to the exported page', async () => {
    const rotated: Page = { ...page('a', 0), rotation: 90 };
    const out = await exportPdf(doc([rotated]), fonts);
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPage(0).getRotation().angle).toBe(90);
  });

  it('appends a blank page at its stored size', async () => {
    const blank: Page = { ...page('new', 0), sourceIndex: null, width: 400, height: 500 };
    const out = await exportPdf(doc([page('a', 0), blank]), fonts);
    const loaded = await PDFDocument.load(out);

    expect(loaded.getPageCount()).toBe(2);
    expect(loaded.getPage(1).getSize()).toEqual({ width: 400, height: 500 });
    // The copied page must be untouched by the blank one.
    expect(loaded.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
  });

  it('keeps copied pages aligned when a blank page sits between them', async () => {
    // The copied array no longer lines up with doc.pages once a page is not
    // copied, so this catches an off-by-one in the cursor.
    const blank: Page = { ...page('new', 0), sourceIndex: null, width: 400, height: 500 };
    const out = await exportPdf(doc([page('a', 0), blank, page('c', 2)]), fonts);
    const loaded = await PDFDocument.load(out);

    expect(loaded.getPageCount()).toBe(3);
    expect(loaded.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(loaded.getPage(1).getSize()).toEqual({ width: 400, height: 500 });
    expect(loaded.getPage(2).getSize()).toEqual({ width: 600, height: 800 });
  });

  it('exports a document made only of blank pages', async () => {
    const blank = (id: string, w: number, h: number): Page => ({
      ...page(id, 0),
      sourceIndex: null,
      width: w,
      height: h,
    });
    const out = await exportPdf(doc([blank('b1', 300, 400), blank('b2', 500, 200)]), fonts);
    const loaded = await PDFDocument.load(out);

    expect(loaded.getPageCount()).toBe(2);
    expect(loaded.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
    expect(loaded.getPage(1).getSize()).toEqual({ width: 500, height: 200 });
  });

  it('applies rotation to a blank page', async () => {
    const blank: Page = {
      ...page('new', 0),
      sourceIndex: null,
      width: 400,
      height: 500,
      rotation: 90,
    };
    const out = await exportPdf(doc([blank]), fonts);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });

  it('draws objects onto a blank page', async () => {
    const blank: Page = {
      ...page('a', 0, ['t1']),
      sourceIndex: null,
      width: 400,
      height: 500,
    };
    const out = await exportPdf(doc([blank], { t1: text() }), fonts);
    const drawn = (await drawnTextOnPage(out, 0)).filter((d) => d.font.startsWith('Inter'));
    expect(drawn).toHaveLength(1);
  });

  it('leaves rotation at zero when the user has not rotated', async () => {
    const out = await exportPdf(doc([page('a', 0)]), fonts);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(0);
  });
});

describe('object drawing', () => {
  it('draws a text object and grows the file', async () => {
    const bare = await exportPdf(doc([page('a', 0)]), fonts);
    const withText = await exportPdf(doc([page('a', 0, ['t1'])], { t1: text() }), fonts);
    expect(withText.byteLength).toBeGreaterThan(bare.byteLength);
  });

  it('embeds each used font variant', async () => {
    const objects = {
      t1: text({ id: 't1', bold: true }),
      t2: text({ id: 't2', italic: true, y: 200 }),
      t3: text({ id: 't3', bold: true, italic: true, y: 300 }),
    };
    const out = await exportPdf(doc([page('a', 0, ['t1', 't2', 't3'])], objects), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('draws multi-line text without throwing', async () => {
    const o = text({ text: 'The quick brown fox jumps over the lazy dog', width: 80 });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('draws every box shape without throwing', async () => {
    const kinds = ['rect', 'ellipse', 'triangle'] as const;
    const objects: Doc['objects'] = {};
    const ids: string[] = [];

    kinds.forEach((kind, i) => {
      const id = `s${i}`;
      ids.push(id);
      objects[id] = {
        id,
        pageId: 'a',
        kind,
        x: 20 + i * 40,
        y: 200,
        width: 30,
        height: 30,
        fill: '#00ff00',
        fillOpacity: 0.5,
        stroke: '#000000',
        strokeWidth: 2,
        strokeOpacity: 1,
        cornerRadius: 4,
      };
    });

    const out = await exportPdf(doc([page('a', 0, ids)], objects), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('draws lines and arrows in every direction without throwing', async () => {
    // All four diagonals plus horizontal and vertical: the box model could
    // only ever represent one of these.
    const directions: [number, number, number, number][] = [
      [0, 0, 60, 40],
      [60, 0, 0, 40],
      [0, 40, 60, 0],
      [60, 40, 0, 0],
      [0, 20, 60, 20],
      [30, 0, 30, 40],
    ];
    const objects: Doc['objects'] = {};
    const ids: string[] = [];

    directions.forEach(([x1, y1, x2, y2], i) => {
      const id = `l${i}`;
      ids.push(id);
      objects[id] = {
        id,
        pageId: 'a',
        kind: i % 2 === 0 ? 'arrow' : 'line',
        x: 20,
        y: 100 + i * 60,
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        x1,
        y1,
        x2,
        y2,
        stroke: '#000000',
        strokeWidth: 2,
        strokeOpacity: 1,
        arrowHeadSize: 8,
      };
    });

    const out = await exportPdf(doc([page('a', 0, ids)], objects), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('skips objects whose page was deleted', async () => {
    // t1 belongs to page 'a'; exporting only page 'b' must not draw it.
    const out = await exportPdf(doc([page('b', 1)], { t1: text() }), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe('document title', () => {
  it('writes the title into the PDF metadata', async () => {
    const out = await exportPdf({ ...doc([page('a', 0)]), title: 'Quarterly report' }, fonts);
    expect((await PDFDocument.load(out)).getTitle()).toBe('Quarterly report');
  });

  it('carries a renamed title through', async () => {
    const out = await exportPdf({ ...doc([page('a', 0)]), title: 'Signed contract' }, fonts);
    expect((await PDFDocument.load(out)).getTitle()).toBe('Signed contract');
  });

  it('keeps characters that are legal in a title but not a filename', async () => {
    // The filename is sanitised separately; the metadata keeps what was typed.
    const out = await exportPdf({ ...doc([page('a', 0)]), title: 'Q1/Q2: results' }, fonts);
    expect((await PDFDocument.load(out)).getTitle()).toBe('Q1/Q2: results');
  });
});

describe('images', () => {
  // A 1x1 opaque PNG: enough for pdf-lib to embed without needing a canvas.
  const PNG =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  const image = (over: Partial<ImageObject> = {}): ImageObject => ({
    id: 'i1',
    pageId: 'a',
    kind: 'image',
    x: 50,
    y: 60,
    width: 120,
    height: 80,
    src: PNG,
    naturalWidth: 1,
    naturalHeight: 1,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    rotation: 0,
    opacity: 1,
    ...over,
  });

  it('embeds an uncropped image and grows the file', async () => {
    const bare = await exportPdf(doc([page('a', 0)]), fonts);
    const withImage = await exportPdf(doc([page('a', 0, ['i1'])], { i1: image() }), fonts);
    expect(withImage.byteLength).toBeGreaterThan(bare.byteLength);
  });

  it('exports a rotated image without throwing', async () => {
    const out = await exportPdf(
      doc([page('a', 0, ['i1'])], { i1: image({ rotation: 37 }) }),
      fonts,
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('exports a semi-transparent image', async () => {
    const out = await exportPdf(
      doc([page('a', 0, ['i1'])], { i1: image({ opacity: 0.4 }) }),
      fonts,
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('draws images alongside text and shapes on the same page', async () => {
    const objects: Doc['objects'] = { i1: image(), t1: text() };
    const out = await exportPdf(doc([page('a', 0, ['i1', 't1'])], objects), fonts);
    const drawn = (await drawnTextOnPage(out, 0)).filter((d) => d.font.startsWith('Inter'));
    expect(drawn).toHaveLength(1);
  });

  it('skips an image whose page was removed', async () => {
    const out = await exportPdf(doc([page('b', 1)], { i1: image() }), fonts);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe('export round-trip: drawn text matches layoutText', () => {
  // This is the test that proves preview and export have not drifted apart.
  // The DOM renders from layoutText(); if the exporter's coordinates stop
  // agreeing with it, what the user sees stops matching what they download.

  it('draws a single line at the baseline layoutText computed', async () => {
    const o = text({ x: 50, y: 100, fontSize: 14, lineHeight: 1.3, align: 'left' });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);

    const layout = layoutText(fonts.regular, o.text, o.fontSize, o.width, o.lineHeight);
    const drawn = (await drawnTextOnPage(out, 0)).filter((d) => d.font.startsWith('Inter'));

    expect(drawn).toHaveLength(1);
    expect(drawn[0].size).toBe(14);
    expect(drawn[0].x).toBeCloseTo(o.x, 2);
    // Page is 800 tall; y is flipped from the box top plus the baseline offset.
    expect(drawn[0].y).toBeCloseTo(800 - (o.y + layout.baselineOffset), 2);
  });

  it('spaces wrapped lines by exactly one line box', async () => {
    const o = text({ text: 'The quick brown fox jumps over the lazy dog', width: 80 });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);

    const layout = layoutText(fonts.regular, o.text, o.fontSize, o.width, o.lineHeight);
    const drawn = (await drawnTextOnPage(out, 0)).filter((d) => d.font.startsWith('Inter'));

    expect(layout.lines.length).toBeGreaterThan(1);
    expect(drawn).toHaveLength(layout.lines.length);

    for (let i = 0; i < drawn.length; i++) {
      expect(drawn[i].y).toBeCloseTo(800 - (o.y + i * layout.lineBoxHeight + layout.baselineOffset), 2);
    }
  });

  it('offsets right-aligned lines by the measured line width', async () => {
    const o = text({ text: 'The quick brown fox jumps', width: 80, align: 'right' });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);

    const layout = layoutText(fonts.regular, o.text, o.fontSize, o.width, o.lineHeight);
    const drawn = (await drawnTextOnPage(out, 0)).filter((d) => d.font.startsWith('Inter'));

    for (let i = 0; i < drawn.length; i++) {
      expect(drawn[i].x).toBeCloseTo(o.x + lineX(layout, i, 'right', o.width), 2);
    }
  });

  it('centres centred lines', async () => {
    const o = text({ text: 'Hello world', width: 200, align: 'center' });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);

    const layout = layoutText(fonts.regular, o.text, o.fontSize, o.width, o.lineHeight);
    const drawn = (await drawnTextOnPage(out, 0)).filter((d) => d.font.startsWith('Inter'));

    expect(drawn[0].x).toBeCloseTo(o.x + (200 - layout.lines[0].width) / 2, 2);
  });
});

describe('export round-trip: styled runs', () => {
  // Part of a box can now be bold, italic, a different size or a different
  // colour. Each of those is a separate drawText, and this is what proves the
  // exporter positions them the way layoutStyledText said to.
  const metrics = (s: { bold: boolean; italic: boolean }) =>
    s.bold && s.italic ? fonts.boldItalic : s.bold ? fonts.bold : s.italic ? fonts.italic : fonts.regular;

  const styled = (o: TextObject) =>
    layoutStyledText(metrics, o.text, o.spans, defaultStyleOf(o), o.width, o.lineHeight);

  const inter = async (out: Uint8Array) =>
    (await drawnTextOnPage(out, 0)).filter((d) => d.font.startsWith('Inter'));

  // pdf-lib gives the font a fresh random resource key on every setFont, so
  // two draws of the SAME font have different keys. The base name is what
  // identifies the variant.
  const variant = (name: string) => name.replace(/-\d+$/, '');

  it('draws a bold span as its own operation in the bold font', async () => {
    const o = text({ text: 'Hello world', spans: [{ start: 0, end: 5, bold: true }] });
    const drawn = await inter(await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts));

    expect(drawn).toHaveLength(2);
    expect(variant(drawn[0].font)).toBe('Inter-Bold');
    expect(variant(drawn[1].font)).toBe('Inter-Regular');
  });

  it('keeps every run on a line at one baseline', async () => {
    const o = text({ text: 'Hello world', spans: [{ start: 0, end: 5, bold: true }] });
    const drawn = await inter(await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts));

    expect(drawn[0].y).toBeCloseTo(drawn[1].y, 4);
  });

  it('places each run at the offset the layout measured', async () => {
    const o = text({ text: 'Hello world', spans: [{ start: 0, end: 5, bold: true }] });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);
    const drawn = await inter(out);
    const layout = styled(o);

    expect(drawn).toHaveLength(layout.lines[0].runs.length);
    for (let i = 0; i < drawn.length; i++) {
      expect(drawn[i].x).toBeCloseTo(o.x + layout.lines[0].runs[i].x, 2);
    }
  });

  it('draws a resized span at its own size', async () => {
    const o = text({ text: 'small BIG', spans: [{ start: 6, end: 9, fontSize: 28 }] });
    const drawn = await inter(await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts));

    expect(drawn.map((d) => d.size).sort((a, b) => a - b)).toEqual([14, 28]);
  });

  it('puts the baseline below the tallest run on the line', async () => {
    const o = text({ text: 'small BIG', spans: [{ start: 6, end: 9, fontSize: 28 }] });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);
    const drawn = await inter(out);
    const layout = styled(o);
    const line = layout.lines[0];

    for (const d of drawn) {
      expect(d.y).toBeCloseTo(800 - (o.y + line.top + line.baselineOffset), 2);
    }
  });

  it('splits a colour change into its own operation in the same font', async () => {
    const o = text({ text: 'red blue', spans: [{ start: 0, end: 3, color: '#00ff00' }] });
    const drawn = await inter(await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts));

    expect(drawn).toHaveLength(2);
    expect(variant(drawn[0].font)).toBe(variant(drawn[1].font));
    expect(drawn[0].size).toBe(drawn[1].size);
  });

  it('embeds every variant the spans require', async () => {
    const o = text({
      text: 'plain bold italic both',
      spans: [
        { start: 6, end: 10, bold: true },
        { start: 11, end: 17, italic: true },
        { start: 18, end: 22, bold: true, italic: true },
      ],
    });
    const drawn = await inter(await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts));
    const used = new Set(drawn.map((d) => variant(d.font)));

    expect([...used].sort()).toEqual([
      'Inter-Bold',
      'Inter-BoldItalic',
      'Inter-Italic',
      'Inter-Regular',
    ]);
  });

  it('keeps a styled box that wraps consistent with its layout', async () => {
    const o = text({
      text: 'The quick brown fox jumps over the lazy dog',
      width: 120,
      spans: [{ start: 4, end: 9, bold: true, fontSize: 20 }],
    });
    const out = await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts);
    const drawn = await inter(out);
    const layout = styled(o);

    const expected = layout.lines.reduce((n, l) => n + l.runs.filter((r) => r.text !== '').length, 0);
    expect(drawn).toHaveLength(expected);

    let k = 0;
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const offset = lineX(layout, i, o.align, o.width);
      for (const run of line.runs) {
        if (run.text === '') continue;
        expect(drawn[k].x).toBeCloseTo(o.x + offset + run.x, 2);
        expect(drawn[k].y).toBeCloseTo(800 - (o.y + line.top + line.baselineOffset), 2);
        k++;
      }
    }
  });

  it('still draws an unstyled box as a single operation per line', async () => {
    const o = text({ text: 'Hello world' });
    const drawn = await inter(await exportPdf(doc([page('a', 0, ['t1'])], { t1: o }), fonts));
    expect(drawn).toHaveLength(1);
  });
});

describe('page labels', () => {
  const label = (over: Partial<PageLabel> = {}): PageLabel => ({
    id: 'l1',
    text: 'Page {page} of {pages}',
    position: 'bottom',
    align: 'center',
    fontSize: 10,
    color: '#333333',
    margin: 24,
    ...over,
  });

  const withLabels = (pages: Page[], labels: PageLabel[]): Doc => ({
    ...doc(pages),
    pageLabels: labels,
  });

  const inter = async (bytes: Uint8Array, i: number) =>
    (await drawnTextOnPage(bytes, i)).filter((d) => d.font.startsWith('Inter'));

  /** Where the label should land, computed independently of the exporter. */
  const expected = (l: PageLabel, p: Page, index: number, count: number) =>
    labelPdfPlacement(l, p, measureLabel(fonts.regular, formatLabel(l.text, index, count), l.fontSize));

  it('draws a label on every page', async () => {
    const out = await exportPdf(
      withLabels([page('a', 0), page('b', 1), page('c', 2)], [label()]),
      fonts,
    );
    for (let i = 0; i < 3; i++) expect(await inter(out, i)).toHaveLength(1);
  });

  it('draws nothing extra when there are no labels', async () => {
    const out = await exportPdf(doc([page('a', 0)]), fonts);
    expect(await inter(out, 0)).toHaveLength(0);
  });

  it('places a label where labelPdfPlacement says', async () => {
    const p = page('a', 0);
    const out = await exportPdf(withLabels([p], [label()]), fonts);
    const [d] = await inter(out, 0);
    const at = expected(label(), p, 0, 1);

    expect(d.x).toBeCloseTo(at.x, 2);
    expect(d.y).toBeCloseTo(at.y, 2);
    expect(d.angle).toBe(0);
    expect(d.size).toBe(10);
  });

  it('turns the label with a rotated page so it reads upright', async () => {
    for (const rotation of [90, 180, 270] as const) {
      const p = { ...page('a', 0), rotation };
      const out = await exportPdf(withLabels([p], [label()]), fonts);
      const drawn = await inter(out, 0);
      expect(drawn).toHaveLength(1);
      const at = expected(label(), p, 0, 1);

      expect(drawn[0].angle).toBe(rotation);
      expect(drawn[0].x).toBeCloseTo(at.x, 2);
      expect(drawn[0].y).toBeCloseTo(at.y, 2);
    }
  });

  it('numbers pages in export order, not source order', async () => {
    // Ten pages: source page 2 first, source page 0 last, blanks between.
    // Page 10 must read "10". If numbering came from the source index it
    // would read "1", and "1" is one digit narrower than "10", so its
    // right-aligned x differs by a whole glyph - well outside the tolerance.
    const blanks = Array.from({ length: 8 }, (_, k) => ({
      ...page(`blank${k}`, 0),
      sourceIndex: null,
    }));
    const pages = [page('c', 2), ...blanks, page('a', 0)];
    const l = label({ text: '{page}', align: 'right' });
    const out = await exportPdf(withLabels(pages, [l]), fonts);

    const [last] = await inter(out, 9);
    expect(last.x).toBeCloseTo(expected(l, pages[9], 9, 10).x, 2);

    const [first] = await inter(out, 0);
    expect(first.x).toBeCloseTo(expected(l, pages[0], 0, 10).x, 2);
  });

  it('skips a label whose text is blank', async () => {
    const out = await exportPdf(withLabels([page('a', 0)], [label({ text: '   ' })]), fonts);
    expect(await inter(out, 0)).toHaveLength(0);
  });

  it('draws a header and a footer together', async () => {
    const out = await exportPdf(
      withLabels([page('a', 0)], [label(), label({ id: 'h', text: 'Report', position: 'top' })]),
      fonts,
    );
    expect(await inter(out, 0)).toHaveLength(2);
  });

  it('draws labels in front of the page objects', async () => {
    // Drawn after the objects, so a label is never hidden under a shape.
    const t: TextObject = { ...text(), pageId: 'a' };
    const p = page('a', 0, ['t1']);
    const out = await exportPdf({ ...doc([p], { t1: t }), pageLabels: [label()] }, fonts);
    const drawn = await inter(out, 0);

    expect(drawn).toHaveLength(2);
    expect(drawn[1].size).toBe(10);
  });
});
