import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { nextId } from '../model/store';
import type { Doc, Page } from '../model/types';

// The worker is referenced by URL, not imported via Vite's `?worker` helper:
// that helper wraps the module in a way that breaks pdf.js's own message
// protocol, leaving parsing working but rendering silently hanging forever.
//
// This emits a `.mjs` asset, so the server MUST send it with a JavaScript MIME
// type or the browser refuses to execute it as a module. See the .mjs types
// block in docker/nginx.conf.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfLoadError extends Error {}

export interface LoadedPdf {
  doc: Doc;
  proxy: PDFDocumentProxy;
}

/** Open raw PDF bytes, returning a render proxy and the page geometry. */
export async function openBytes(bytes: Uint8Array, fileName: string): Promise<LoadedPdf> {
  let proxy: PDFDocumentProxy;
  try {
    // pdf.js takes ownership of the buffer it is given, so hand it a copy and
    // keep ours intact for pdf-lib at export time.
    proxy = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new PdfLoadError(
        'This PDF is password-protected. Encrypted PDFs are not supported.',
      );
    }
    throw new PdfLoadError('This file could not be opened as a PDF.');
  }

  const pages: Page[] = [];
  for (let i = 1; i <= proxy.numPages; i++) {
    const p = await proxy.getPage(i);
    // getViewport at scale 1 already accounts for the source /Rotate, so these
    // are the dimensions the user sees before applying any rotation of theirs.
    const vp = p.getViewport({ scale: 1 });
    pages.push({
      id: nextId('page'),
      sourceIndex: i - 1,
      rotation: 0,
      width: vp.width,
      height: vp.height,
      objectIds: [],
    });
  }

  return { doc: { fileName, sourceBytes: bytes, pages, objects: {} }, proxy };
}

export async function loadDocument(file: File): Promise<LoadedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return openBytes(bytes, file.name);
}
