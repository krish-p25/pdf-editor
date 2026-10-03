import { PDFDocument } from '@cantoo/pdf-lib';

export class PdfImportError extends Error {}

export interface AppendResult {
  /** The combined document. */
  bytes: Uint8Array;
  /** Pages the base document had. Imported pages start at this index. */
  originalPageCount: number;
  addedPageCount: number;
}

/** A file to merge in, already read into memory. */
export interface IncomingPdf {
  name: string;
  bytes: Uint8Array;
}

export interface MergeResult {
  /** The combined document. */
  bytes: Uint8Array;
  /** Pages the base document had. Imported pages start at this index. */
  originalPageCount: number;
  /** Files that made it in, in the order their pages were appended. */
  added: { name: string; pageCount: number }[];
  /** Files that could not be read, with the reason. */
  skipped: { name: string; reason: string }[];
}

/** Load an incoming PDF, turning pdf-lib's errors into a reason a person can act on. */
async function loadIncoming(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'EncryptedPDFError' || /encrypt/i.test(String(e))) {
      throw new PdfImportError('That PDF is password-protected, so it cannot be imported.');
    }
    throw new PdfImportError('That file could not be read as a PDF.');
  }
}

/**
 * Append several PDFs' pages after a base document, returning the combined
 * bytes.
 *
 * The base document's pages are copied first, in their original order, so
 * every `sourceIndex` already stored on a Page stays valid and the imported
 * pages simply continue the numbering. That is what lets an import avoid a
 * schema change: the document keeps exactly one source PDF.
 *
 * Pass `null` as the base to build a fresh document from the files alone.
 *
 * One unreadable file does not sink the batch: it is skipped and reported, and
 * only a batch in which every file failed is an error. All files are copied
 * into a single output in one pass, rather than merging and re-saving once per
 * file.
 */
export async function appendPdfs(
  base: Uint8Array | null,
  incoming: readonly IncomingPdf[],
): Promise<MergeResult> {
  if (incoming.length === 0) throw new PdfImportError('No PDF files were chosen.');

  let baseDoc: PDFDocument | null = null;
  if (base) {
    try {
      baseDoc = await PDFDocument.load(base);
    } catch {
      throw new PdfImportError('The current document could not be read.');
    }
  }

  const out = await PDFDocument.create();

  let originalPageCount = 0;
  if (baseDoc) {
    originalPageCount = baseDoc.getPageCount();
    for (const p of await out.copyPages(baseDoc, baseDoc.getPageIndices())) out.addPage(p);
  }

  const added: MergeResult['added'] = [];
  const skipped: MergeResult['skipped'] = [];

  for (const file of incoming) {
    let doc: PDFDocument;
    try {
      doc = await loadIncoming(file.bytes);
    } catch (e) {
      skipped.push({ name: file.name, reason: (e as Error).message });
      continue;
    }

    const pageCount = doc.getPageCount();
    if (pageCount === 0) {
      skipped.push({ name: file.name, reason: 'That PDF has no pages.' });
      continue;
    }

    for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
    added.push({ name: file.name, pageCount });
  }

  if (added.length === 0) {
    // A single file fails with its own reason, exactly as importing one file
    // always has.
    throw new PdfImportError(
      incoming.length === 1
        ? skipped[0].reason
        : `None of those ${incoming.length} PDFs could be imported.`,
    );
  }

  return { bytes: await out.save(), originalPageCount, added, skipped };
}

/**
 * Append one PDF's pages to another.
 *
 * Kept as a thin wrapper over appendPdfs so the established single-file tests
 * continue to pin single-file behaviour and its error messages.
 */
export async function appendPdf(base: Uint8Array, incoming: Uint8Array): Promise<AppendResult> {
  const r = await appendPdfs(base, [{ name: 'import.pdf', bytes: incoming }]);
  return {
    bytes: r.bytes,
    originalPageCount: r.originalPageCount,
    addedPageCount: r.added[0].pageCount,
  };
}

/**
 * Natural filename order, so "2.pdf" sorts before "10.pdf".
 *
 * The file dialog's own order is unreliable (on Windows the focused file comes
 * first), and people number files they mean to merge.
 */
export function orderForMerge<T extends { name: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/** Whether a dropped or chosen file is worth trying as a PDF. */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** A notice for files that were skipped, or null when everything went in. */
export function skippedMessage(
  result: Pick<MergeResult, 'added' | 'skipped'>,
  total: number,
): string | null {
  if (result.skipped.length === 0) return null;
  const [first, ...rest] = result.skipped;
  const others =
    rest.length === 0
      ? ''
      : rest.length === 1
        ? ' 1 other file was also skipped.'
        : ` ${rest.length} other files were also skipped.`;
  return `Imported ${result.added.length} of ${total} PDFs. ${first.name} was skipped — ${first.reason}${others}`;
}
