import { useCallback, useRef, useState } from 'react';

interface Props {
  onFile(file: File): void;
  error: string | null;
}

export function DropZone({ onFile, error }: Props) {
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
    <div className="flex h-full items-center justify-center bg-panel p-8">
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
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-16 text-center transition-colors ${
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
    </div>
  );
}
