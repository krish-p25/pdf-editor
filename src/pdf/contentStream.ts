import { PDFArray, PDFDocument, PDFRawStream, type PDFRef } from '@cantoo/pdf-lib';
import { inflateSync } from 'node:zlib';

export interface DrawnText {
  font: string;
  size: number;
  x: number;
  y: number;
}

/**
 * Decode a page's content stream and extract every text-drawing operation
 * with its absolute position.
 *
 * Test-only: this exists so the export round-trip can assert that drawn text
 * lands exactly where layoutText() said it would. It relies on node:zlib and
 * is never imported by application code.
 */
export async function drawnTextOnPage(bytes: Uint8Array, pageIndex: number): Promise<DrawnText[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) return [];

  const items = contents instanceof PDFArray ? contents.asArray() : [contents];

  let source = '';
  for (const item of items) {
    const stream = item instanceof PDFRawStream ? item : doc.context.lookup(item as PDFRef);
    if (!(stream instanceof PDFRawStream)) continue;
    const raw = Buffer.from(stream.contents);
    let decoded: string;
    try {
      decoded = inflateSync(raw).toString('latin1');
    } catch {
      decoded = raw.toString('latin1');
    }
    source += `${decoded}\n`;
  }

  const out: DrawnText[] = [];
  // Each drawText emits one BT..ET block containing a Tf and a Tm.
  for (const block of source.split('BT').slice(1)) {
    const body = block.split('ET')[0];
    const tf = body.match(/\/([^\s/]+)\s+([\d.]+)\s+Tf/);
    const tm = body.match(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/);
    if (!tf || !tm) continue;
    out.push({
      font: tf[1],
      size: Number(tf[2]),
      x: Number(tm[1]),
      y: Number(tm[2]),
    });
  }

  return out;
}
