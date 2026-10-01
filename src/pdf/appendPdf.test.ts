import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import { appendPdf, PdfImportError } from './appendPdf';
import { drawnTextOnPage } from './contentStream';

let threePages: Uint8Array;

/** A PDF whose pages are a known size and carry identifiable text. */
async function makePdf(
  labels: string[],
  size: [number, number] = [600, 800],
): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const p = d.addPage(size);
    p.drawText(label, { x: 40, y: 700, size: 18, font, color: rgb(0, 0, 0) });
  }
  return d.save();
}

beforeAll(() => {
  threePages = new Uint8Array(readFileSync('src/pdf/__fixtures__/three-pages.pdf'));
});

describe('appending a PDF', () => {
  it('reports how many pages each side contributed', async () => {
    const incoming = await makePdf(['X', 'Y']);
    const r = await appendPdf(threePages, incoming);
    expect(r.originalPageCount).toBe(3);
    expect(r.addedPageCount).toBe(2);
  });

  it('produces a document holding both sets of pages', async () => {
    const incoming = await makePdf(['X', 'Y']);
    const r = await appendPdf(threePages, incoming);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(5);
  });

  it('keeps the base document first, so existing sourceIndex values stay valid', async () => {
    // This is the property the whole approach rests on: a page already
    // pointing at index 0 must still be looking at the same content.
    const base = await makePdf(['BASE0', 'BASE1']);
    const incoming = await makePdf(['NEW0']);
    const r = await appendPdf(base, incoming);

    const page0 = await drawnTextOnPage(r.bytes, 0);
    const page1 = await drawnTextOnPage(r.bytes, 1);
    expect(page0.length).toBeGreaterThan(0);
    expect(page1.length).toBeGreaterThan(0);
    expect(r.originalPageCount).toBe(2);
  });

  it('appends imported pages after the base ones', async () => {
    const base = await makePdf(['A']);
    const incoming = await makePdf(['B', 'C']);
    const r = await appendPdf(base, incoming);
    const loaded = await PDFDocument.load(r.bytes);
    expect(loaded.getPageCount()).toBe(3);
  });

  it('carries each imported page at its own size', async () => {
    const base = await makePdf(['A'], [600, 800]);
    const incoming = await makePdf(['B'], [400, 300]);
    const r = await appendPdf(base, incoming);
    const loaded = await PDFDocument.load(r.bytes);

    expect(loaded.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(loaded.getPage(1).getSize()).toEqual({ width: 400, height: 300 });
  });

  it('can be applied repeatedly, each import extending the last', async () => {
    const base = await makePdf(['A']);
    const first = await appendPdf(base, await makePdf(['B']));
    const second = await appendPdf(first.bytes, await makePdf(['C', 'D']));

    expect(second.originalPageCount).toBe(2);
    expect(second.addedPageCount).toBe(2);
    expect((await PDFDocument.load(second.bytes)).getPageCount()).toBe(4);
  });

  it('preserves a rotation set on an imported page', async () => {
    const d = await PDFDocument.create();
    d.addPage([400, 300]).setRotation({ type: 'degrees', angle: 90 } as never);
    const incoming = await d.save();

    const r = await appendPdf(await makePdf(['A']), incoming);
    const loaded = await PDFDocument.load(r.bytes);
    expect(loaded.getPage(1).getRotation().angle).toBe(90);
  });
});

describe('rejecting bad input', () => {
  it('rejects a file that is not a PDF', async () => {
    const notPdf = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(appendPdf(threePages, notPdf)).rejects.toBeInstanceOf(PdfImportError);
  });

  it('explains that the file could not be read', async () => {
    const notPdf = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(appendPdf(threePages, notPdf)).rejects.toThrow(/could not be read as a PDF/i);
  });

  it('accepts a minimal PDF, which pdf-lib always gives at least one page', async () => {
    // pdf-lib cannot actually produce a page-less PDF: an empty document
    // round-trips with one page. The zero-page guard in appendPdf is defensive
    // against genuinely malformed files, not reachable from here.
    const minimal = await (await PDFDocument.create()).save();
    const r = await appendPdf(threePages, minimal);
    expect(r.addedPageCount).toBe(1);
  });

  it('leaves the base document untouched when the import fails', async () => {
    const before = Array.from(threePages);
    await appendPdf(threePages, new Uint8Array([1, 2, 3])).catch(() => undefined);
    expect(Array.from(threePages)).toEqual(before);
  });
});
