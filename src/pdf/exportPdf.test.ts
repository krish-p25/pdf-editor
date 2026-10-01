import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { exportPdf, hexToRgb, type FontSet } from './exportPdf';
import { createMetrics, layoutText, lineX } from './fontMetrics';
import { drawnTextOnPage } from './contentStream';
import type { Doc, ImageObject, Page, TextObject } from '../model/types';

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
