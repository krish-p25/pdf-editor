import { PDFDocument } from '@cantoo/pdf-lib';

export class PdfImportError extends Error {}

export interface AppendResult {
  /** The combined document. */
  bytes: Uint8Array;
  /** Pages the base document had. Imported pages start at this index. */
  originalPageCount: number;
  addedPageCount: number;
}

/**
 * Append one PDF's pages to another, returning the combined bytes.
 *
 * The base document's pages are copied first, in their original order, so
 * every `sourceIndex` already stored on a Page stays valid and the imported
 * pages simply continue the numbering. That is what lets an import avoid a
 * schema change: the document keeps exactly one source PDF.
 *
 * Pages deleted in the editor are still present in the base bytes — nothing
 * prunes them — which is also what keeps existing indices stable.
 */
export async function appendPdf(base: Uint8Array, incoming: Uint8Array): Promise<AppendResult> {
  let baseDoc: PDFDocument;
  try {
    baseDoc = await PDFDocument.load(base);
  } catch {
    throw new PdfImportError('The current document could not be read.');
  }

  let incomingDoc: PDFDocument;
  try {
    incomingDoc = await PDFDocument.load(incoming);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'EncryptedPDFError' || /encrypt/i.test(String(e))) {
      throw new PdfImportError('That PDF is password-protected, so it cannot be imported.');
    }
    throw new PdfImportError('That file could not be read as a PDF.');
  }

  const originalPageCount = baseDoc.getPageCount();
  const addedPageCount = incomingDoc.getPageCount();
  if (addedPageCount === 0) {
    throw new PdfImportError('That PDF has no pages.');
  }

  const out = await PDFDocument.create();

  const fromBase = await out.copyPages(baseDoc, baseDoc.getPageIndices());
  for (const p of fromBase) out.addPage(p);

  const fromIncoming = await out.copyPages(incomingDoc, incomingDoc.getPageIndices());
  for (const p of fromIncoming) out.addPage(p);

  return { bytes: await out.save(), originalPageCount, addedPageCount };
}
