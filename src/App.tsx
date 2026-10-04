import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useStore } from './model/store';
import { loadDocument, openBytes, openProxy, PdfLoadError } from './pdf/loadDocument';
import { exportPdf, type FontSet } from './pdf/exportPdf';
import { bundleImages, rasterisePdf, type ImageExportFormat } from './pdf/exportImages';
import { primeFont } from './pdf/fontMetrics';
import { clearRenderCache } from './pdf/renderPage';
import { loadImageFile, ImageLoadError } from './pdf/imageFile';
import {
  appendPdfs,
  isPdfFile,
  orderForMerge,
  PdfImportError,
  skippedMessage,
  type IncomingPdf,
} from './pdf/appendPdf';
import {
  createAutosave,
  deleteDocument,
  listDocuments,
  loadStoredDocument,
  saveDocument,
  type DocumentSummary,
} from './model/persistence';
import { exportFileName, exportStem } from './model/title';
import { useKeyboard } from './hooks/useKeyboard';
import { DropZone } from './components/DropZone';
import { Toolbar } from './components/Toolbar';
import { ThumbnailRail } from './components/ThumbnailRail';
import { PageCanvas } from './components/PageCanvas';
import { PageLabelsOverlay } from './components/PageLabelsOverlay';
import { ObjectLayer } from './components/ObjectLayer';
import { PropertiesPanel } from './components/PropertiesPanel';

/**
 * Which document was open when the page last unloaded.
 *
 * Kept in localStorage rather than IndexedDB: it is a single short string, it
 * is read on the very first render before any async work, and losing it is
 * harmless — the worst case is landing on the document list.
 */
const LAST_OPENED_KEY = 'pdf-editor:lastOpened';

function readLastOpened(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED_KEY);
  } catch {
    return null;
  }
}

function writeLastOpened(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(LAST_OPENED_KEY);
    else localStorage.setItem(LAST_OPENED_KEY, id);
  } catch {
    /* private mode or blocked storage: reopening is a convenience, not a need */
  }
}

/** Load all four Inter variants, which export needs whatever the document uses. */
async function loadFontSet(): Promise<FontSet> {
  const [regular, bold, italic, boldItalic] = await Promise.all([
    primeFont('regular'),
    primeFont('bold'),
    primeFont('italic'),
    primeFont('boldItalic'),
  ]);
  return { regular, bold, italic, boldItalic };
}

/** Hand bytes to the browser as a download. */
function saveFile(bytes: Uint8Array, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read chosen files into the shape the merge step takes. */
function readPdfs(files: readonly File[]): Promise<IncomingPdf[]> {
  return Promise.all(
    files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

export default function App() {
  const doc = useStore((s) => s.doc);
  const activePageId = useStore((s) => s.activePageId);
  const zoom = useStore((s) => s.zoom);
  const error = useStore((s) => s.error);
  const loadDoc = useStore((s) => s.loadDoc);
  const setError = useStore((s) => s.setError);
  const setSnapEnabled = useStore((s) => s.setSnapEnabled);
  const closeDoc = useStore((s) => s.closeDoc);
  const addImage = useStore((s) => s.addImage);
  const appendImportedPages = useStore((s) => s.appendImportedPages);

  const [proxy, setProxy] = useState<PDFDocumentProxy | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const autosave = useRef(createAutosave());

  useKeyboard();

  // Alt suppresses snapping while held, for when it keeps fighting a nudge.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setSnapEnabled(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setSnapEnabled(true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [setSnapEnabled]);

  const refreshDocuments = useCallback(async () => {
    setDocuments(await listDocuments());
  }, []);

  // Reopen whatever was last being edited. An explicit Close clears the
  // pointer, so closing to the list and reloading keeps you on the list
  // rather than dragging you back into a document you just left.
  useEffect(() => {
    void (async () => {
      await refreshDocuments();

      const lastId = readLastOpened();
      if (!lastId || useStore.getState().doc) return;

      const stored = await loadStoredDocument(lastId);
      if (!stored) {
        writeLastOpened(null);
        return;
      }
      try {
        const opened = await openBytes(stored.sourceBytes, stored.fileName);
        setProxy(opened.proxy);
        loadDoc(stored);
        void primeFont('regular');
      } catch {
        writeLastOpened(null);
      }
    })();
  }, [loadDoc, refreshDocuments]);

  useEffect(() => {
    if (doc) autosave.current(doc);
  }, [doc]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (useStore.getState().doc) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // A file dropped anywhere the app does not handle would otherwise make the
  // browser navigate to it, throwing the user out of the editor over a
  // near-miss. Swallowing it at the window makes a stray drop a no-op.
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        clearRenderCache();
        const loaded = await loadDocument(file);
        setProxy(loaded.proxy);
        loadDoc(loaded.doc);
        writeLastOpened(loaded.doc.id);
        void primeFont('regular');
      } catch (e) {
        setError(
          e instanceof PdfLoadError ? e.message : 'Something went wrong opening that file.',
        );
      } finally {
        setBusy(false);
      }
    },
    [loadDoc, setError],
  );

  const onFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // One file keeps the exact single-file path, and its error messages.
      if (files.length === 1) return onFile(files[0]);

      const pdfs = files.filter(isPdfFile);
      if (pdfs.length === 0) {
        setError('Only PDF files can be opened.');
        return;
      }
      if (pdfs.length === 1) return onFile(pdfs[0]);

      setBusy(true);
      setError(null);
      try {
        clearRenderCache();
        const merged = await appendPdfs(null, await readPdfs(orderForMerge(pdfs)));
        // Named after the first file that made it in; renaming is one click.
        const loaded = await openBytes(merged.bytes, merged.added[0].name);
        setProxy(loaded.proxy);
        loadDoc(loaded.doc);
        writeLastOpened(loaded.doc.id);
        void primeFont('regular');
        // After loadDoc, which clears the error, so the notice survives.
        setError(skippedMessage(merged, pdfs.length));
      } catch (e) {
        setError(
          e instanceof PdfImportError || e instanceof PdfLoadError
            ? e.message
            : 'Those files could not be merged.',
        );
      } finally {
        setBusy(false);
      }
    },
    [loadDoc, onFile, setError],
  );

  const onOpenDocument = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        const stored = await loadStoredDocument(id);
        if (!stored) {
          setError('That document could no longer be found.');
          await refreshDocuments();
          return;
        }
        // The render cache is keyed by page index and scale with no document
        // identity, so it must be dropped when switching documents.
        clearRenderCache();
        const opened = await openBytes(stored.sourceBytes, stored.fileName);
        setProxy(opened.proxy);
        loadDoc(stored);
        writeLastOpened(stored.id);
        void primeFont('regular');
      } catch (e) {
        setError(e instanceof PdfLoadError ? e.message : 'That document could not be opened.');
      } finally {
        setBusy(false);
      }
    },
    [loadDoc, refreshDocuments, setError],
  );

  const onDeleteDocument = useCallback(
    async (id: string) => {
      await deleteDocument(id);
      if (readLastOpened() === id) writeLastOpened(null);
      await refreshDocuments();
    },
    [refreshDocuments],
  );

  const onInsertImage = useCallback(
    async (file: File) => {
      setError(null);
      try {
        addImage(await loadImageFile(file));
      } catch (e) {
        setError(e instanceof ImageLoadError ? e.message : 'That image could not be inserted.');
      }
    },
    [addImage, setError],
  );

  const onImportPdfs = useCallback(
    async (files: File[]) => {
      const current = useStore.getState().doc;
      if (!current || files.length === 0) return;

      setBusy(true);
      setError(null);
      try {
        const merged = await appendPdfs(current.sourceBytes, await readPdfs(orderForMerge(files)));

        // Reopen against the merged bytes so page geometry comes from pdf.js,
        // exactly as it does on first load — pdf-lib's getSize() ignores
        // /Rotate, which would give swapped dimensions for rotated pages.
        const opened = await openBytes(merged.bytes, current.fileName);

        const addedPages = merged.added.reduce((n, a) => n + a.pageCount, 0);
        const added = [];
        for (let i = merged.originalPageCount; i < merged.originalPageCount + addedPages; i++) {
          const pdfPage = await opened.proxy.getPage(i + 1);
          const vp = pdfPage.getViewport({ scale: 1 });
          added.push({
            sourceIndex: i,
            rotation: 0 as const,
            width: vp.width,
            height: vp.height,
            objectIds: [],
          });
        }

        // The render cache is keyed by page index with no document identity,
        // and the bytes behind those indices have just changed.
        clearRenderCache();
        setProxy(opened.proxy);
        // One call, so importing several files is a single undo step.
        appendImportedPages(merged.bytes, added);
        setError(skippedMessage(merged, files.length));
      } catch (e) {
        setError(
          e instanceof PdfImportError
            ? e.message
            : files.length === 1
              ? 'That PDF could not be imported.'
              : 'Those PDFs could not be imported.',
        );
      } finally {
        setBusy(false);
      }
    },
    [appendImportedPages, setError],
  );

  const onExport = useCallback(async () => {
    const current = useStore.getState().doc;
    if (!current) return;
    setExporting(true);
    setError(null);
    try {
      const bytes = await exportPdf(current, await loadFontSet());
      saveFile(bytes, exportFileName(current.title), 'application/pdf');
    } catch (e) {
      setError(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [setError]);

  const onExportImages = useCallback(
    async (format: ImageExportFormat, dpi: number) => {
      const current = useStore.getState().doc;
      if (!current) return;
      setExporting(true);
      setError(null);
      try {
        // Rasterise the EXPORTED file rather than the source pages, so every
        // edit is in the images and they match the PDF export exactly.
        const pdf = await exportPdf(current, await loadFontSet());
        const exported = await openProxy(pdf);
        try {
          const images = await rasterisePdf(exported, format, dpi);
          const out = bundleImages(exportStem(current.title), images, format);
          saveFile(out.bytes, out.fileName, out.mime);
        } finally {
          void exported.destroy();
        }
      } catch (e) {
        setError(e instanceof Error ? `Image export failed: ${e.message}` : 'Image export failed.');
      } finally {
        setExporting(false);
      }
    },
    [setError],
  );

  const onCloseDoc = useCallback(() => {
    const current = useStore.getState().doc;

    // Flush instead of dropping: closing is no longer destructive, so the
    // latest edits must reach storage before the editor lets go of them.
    autosave.current.cancel();

    void (async () => {
      if (current) await saveDocument(current);
      writeLastOpened(null);
      await refreshDocuments();
    })();

    // The render cache is keyed by page index and scale with no document
    // identity, so it has to go or the next PDF shows this one's pages.
    clearRenderCache();

    setProxy(null);
    closeDoc();
  }, [closeDoc, refreshDocuments]);

  const activePage = useMemo(
    () => doc?.pages.find((p) => p.id === activePageId) ?? null,
    [doc, activePageId],
  );

  if (!doc || !proxy) {
    return busy ? (
      <div className="flex h-full items-center justify-center text-slate-500">Opening…</div>
    ) : (
      <DropZone
        onFiles={onFiles}
        error={error}
        documents={documents}
        onOpenDocument={onOpenDocument}
        onDeleteDocument={onDeleteDocument}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onExport={onExport}
        onExportImages={onExportImages}
        exporting={exporting}
        onCloseDoc={onCloseDoc}
        onInsertImage={onInsertImage}
      />

      {error && (
        <div className="flex shrink-0 items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ThumbnailRail proxy={proxy} onImportPdfs={onImportPdfs} />
        <main className="flex-1 overflow-auto bg-slate-200 p-8">
          <div className="flex justify-center">
            {activePage && (
              <PageCanvas
                proxy={proxy}
                page={activePage}
                zoom={zoom}
                displayOverlay={
                  <PageLabelsOverlay
                    page={activePage}
                    index={doc.pages.findIndex((p) => p.id === activePage.id)}
                    count={doc.pages.length}
                    labels={doc.pageLabels ?? []}
                    zoom={zoom}
                  />
                }
              >
                <ObjectLayer page={activePage} zoom={zoom} />
              </PageCanvas>
            )}
          </div>
        </main>
        <PropertiesPanel />
      </div>
    </div>
  );
}
