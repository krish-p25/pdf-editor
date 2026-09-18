import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useStore } from './model/store';
import { loadDocument, openBytes, PdfLoadError } from './pdf/loadDocument';
import { exportPdf, type FontSet } from './pdf/exportPdf';
import { primeFont } from './pdf/fontMetrics';
import { clearRenderCache } from './pdf/renderPage';
import { clearSession, createAutosave, loadSession } from './model/persistence';
import { useKeyboard } from './hooks/useKeyboard';
import { DropZone } from './components/DropZone';
import { Toolbar } from './components/Toolbar';
import { ThumbnailRail } from './components/ThumbnailRail';
import { PageCanvas } from './components/PageCanvas';
import { ObjectLayer } from './components/ObjectLayer';
import { PropertiesPanel } from './components/PropertiesPanel';

export default function App() {
  const doc = useStore((s) => s.doc);
  const activePageId = useStore((s) => s.activePageId);
  const zoom = useStore((s) => s.zoom);
  const error = useStore((s) => s.error);
  const loadDoc = useStore((s) => s.loadDoc);
  const setError = useStore((s) => s.setError);
  const setSnapEnabled = useStore((s) => s.setSnapEnabled);

  const [proxy, setProxy] = useState<PDFDocumentProxy | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
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

  // Restore a previous session, if one survived.
  useEffect(() => {
    void (async () => {
      const restored = await loadSession();
      if (!restored || useStore.getState().doc) return;
      try {
        const opened = await openBytes(restored.sourceBytes, restored.fileName);
        setProxy(opened.proxy);
        // Keep the restored pages and objects, not the freshly-derived ones.
        loadDoc(restored);
        void primeFont('regular');
      } catch {
        await clearSession();
      }
    })();
  }, [loadDoc]);

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

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        clearRenderCache();
        const loaded = await loadDocument(file);
        setProxy(loaded.proxy);
        loadDoc(loaded.doc);
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

  const onExport = useCallback(async () => {
    const current = useStore.getState().doc;
    if (!current) return;
    setExporting(true);
    setError(null);
    try {
      const [regular, bold, italic, boldItalic] = await Promise.all([
        primeFont('regular'),
        primeFont('bold'),
        primeFont('italic'),
        primeFont('boldItalic'),
      ]);
      const fonts: FontSet = { regular, bold, italic, boldItalic };

      const bytes = await exportPdf(current, fonts);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${current.fileName.replace(/\.pdf$/i, '')}-edited.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [setError]);

  const activePage = useMemo(
    () => doc?.pages.find((p) => p.id === activePageId) ?? null,
    [doc, activePageId],
  );

  if (!doc || !proxy) {
    return busy ? (
      <div className="flex h-full items-center justify-center text-slate-500">Opening…</div>
    ) : (
      <DropZone onFile={onFile} error={error} />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar onExport={onExport} exporting={exporting} />

      {error && (
        <div className="flex shrink-0 items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ThumbnailRail proxy={proxy} />
        <main className="flex-1 overflow-auto bg-slate-200 p-8">
          <div className="flex justify-center">
            {activePage && (
              <PageCanvas proxy={proxy} page={activePage} zoom={zoom}>
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
