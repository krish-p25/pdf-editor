import { useCallback, useRef, useState } from 'react';
import { DocumentList } from './DocumentList';
import type { DocumentSummary } from '../model/persistence';

interface Props {
  onFile(file: File): void;
  error: string | null;
  documents: DocumentSummary[];
  onOpenDocument(id: string): void;
  onDeleteDocument(id: string): void;
}

export function DropZone({
  onFile,
  error,
  documents,
  onOpenDocument,
  onDeleteDocument,
}: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-panel p-8 pt-16">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={`flex w-full max-w-xl shrink-0 cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
          over ? 'border-accent bg-blue-50' : 'border-edge bg-surface hover:border-accent'
        }`}
      >
        <div className="text-lg font-semibold text-slate-800">Drop a PDF here</div>
        <div className="text-sm text-slate-500">or click to choose a file</div>
        <div className="mt-2 text-xs text-slate-400">Everything stays on your device</div>

        {error && <div className="mt-4 text-sm font-medium text-red-600">{error}</div>}

        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => handle(e.target.files)}
        />
      </div>

      <DocumentList
        documents={documents}
        onOpen={onOpenDocument}
        onDelete={onDeleteDocument}
      />
    </div>
  );
}
