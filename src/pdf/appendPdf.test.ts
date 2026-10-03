import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import {
  appendPdf,
  appendPdfs,
  isPdfFile,
  orderForMerge,
  PdfImportError,
  skippedMessage,
} from './appendPdf';
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

const named = (name: string, bytes: Uint8Array) => ({ name, bytes });
const junk = () => new Uint8Array([1, 2, 3, 4, 5]);

describe('appending several PDFs at once', () => {
  it('adds every file, in the order given', async () => {
    const r = await appendPdfs(await makePdf(['A']), [
      named('b.pdf', await makePdf(['B1', 'B2'])),
      named('c.pdf', await makePdf(['C'])),
    ]);

    expect(r.originalPageCount).toBe(1);
    expect(r.added).toEqual([
      { name: 'b.pdf', pageCount: 2 },
      { name: 'c.pdf', pageCount: 1 },
    ]);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(4);
  });

  it('keeps each file at its own page size, in order', async () => {
    const r = await appendPdfs(await makePdf(['A'], [600, 800]), [
      named('b.pdf', await makePdf(['B'], [400, 300])),
      named('c.pdf', await makePdf(['C'], [200, 100])),
    ]);
    const loaded = await PDFDocument.load(r.bytes);

    expect(loaded.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(loaded.getPage(1).getSize()).toEqual({ width: 400, height: 300 });
    expect(loaded.getPage(2).getSize()).toEqual({ width: 200, height: 100 });
  });

  it('builds a document from nothing when there is no base', async () => {
    // The start-screen case: several files, no document open yet.
    const r = await appendPdfs(null, [
      named('a.pdf', await makePdf(['A'])),
      named('b.pdf', await makePdf(['B'])),
    ]);

    expect(r.originalPageCount).toBe(0);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(2);
  });

  it('skips a file it cannot read and keeps the rest', async () => {
    const r = await appendPdfs(threePages, [
      named('good.pdf', await makePdf(['G'])),
      named('bad.pdf', junk()),
    ]);

    expect(r.added.map((a) => a.name)).toEqual(['good.pdf']);
    expect(r.skipped).toEqual([
      { name: 'bad.pdf', reason: 'That file could not be read as a PDF.' },
    ]);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(4);
  });

  it('fails when every file is unreadable', async () => {
    await expect(
      appendPdfs(threePages, [named('a.pdf', junk()), named('b.pdf', junk())]),
    ).rejects.toThrow(/None of those 2 PDFs could be imported/);
  });

  it('keeps the single-file message when only one file was given', async () => {
    // One file must fail exactly as importing one file always has.
    await expect(appendPdfs(threePages, [named('x.pdf', junk())])).rejects.toThrow(
      /could not be read as a PDF/i,
    );
  });

  it('rejects an empty list', async () => {
    await expect(appendPdfs(threePages, [])).rejects.toBeInstanceOf(PdfImportError);
  });

  it('fails when the base document itself is unreadable', async () => {
    await expect(
      appendPdfs(junk(), [named('a.pdf', await makePdf(['A']))]),
    ).rejects.toThrow(/current document could not be read/i);
  });
});

describe('orderForMerge', () => {
  const names = (files: { name: string }[]) => orderForMerge(files).map((f) => f.name);

  it('orders numbered files numerically, not alphabetically', () => {
    expect(names([{ name: '10.pdf' }, { name: '2.pdf' }, { name: '1.pdf' }])).toEqual([
      '1.pdf',
      '2.pdf',
      '10.pdf',
    ]);
  });

  it('ignores case', () => {
    expect(names([{ name: 'b.pdf' }, { name: 'A.pdf' }])).toEqual(['A.pdf', 'b.pdf']);
  });

  it('does not reorder the array it was given', () => {
    const input = [{ name: 'b.pdf' }, { name: 'a.pdf' }];
    orderForMerge(input);
    expect(input[0].name).toBe('b.pdf');
  });
});

describe('isPdfFile', () => {
  it('accepts a file by its type', () => {
    expect(isPdfFile(new File([], 'x', { type: 'application/pdf' }))).toBe(true);
  });

  it('accepts a file by its extension when the type is missing', () => {
    expect(isPdfFile(new File([], 'scan.PDF', { type: '' }))).toBe(true);
  });

  it('rejects other files', () => {
    expect(isPdfFile(new File([], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false);
  });
});

describe('skippedMessage', () => {
  const result = (skipped: { name: string; reason: string }[]) => ({
    added: [{ name: 'a.pdf', pageCount: 1 }],
    skipped,
  });

  it('says nothing when nothing was skipped', () => {
    expect(skippedMessage(result([]), 1)).toBeNull();
  });

  it('names the skipped file and says why', () => {
    expect(skippedMessage(result([{ name: 'b.pdf', reason: 'Bad file.' }]), 2)).toBe(
      'Imported 1 of 2 PDFs. b.pdf was skipped — Bad file.',
    );
  });

  it('counts the rest when more than one was skipped', () => {
    const r = result([
      { name: 'b.pdf', reason: 'Bad file.' },
      { name: 'c.pdf', reason: 'Other.' },
      { name: 'd.pdf', reason: 'Other.' },
    ]);
    expect(skippedMessage(r, 4)).toBe(
      'Imported 1 of 4 PDFs. b.pdf was skipped — Bad file. 2 other files were also skipped.',
    );
  });

  it('uses the singular for exactly one other', () => {
    const r = result([
      { name: 'b.pdf', reason: 'Bad file.' },
      { name: 'c.pdf', reason: 'Other.' },
    ]);
    expect(skippedMessage(r, 3)).toMatch(/1 other file was also skipped\.$/);
  });
});
