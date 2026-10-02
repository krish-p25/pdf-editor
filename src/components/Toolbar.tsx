import { useEffect, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { normaliseTitle } from '../model/title';
import type { ToolId } from '../model/types';
import { EXTRA_IMAGE_EXTENSIONS } from '../pdf/imageFile';

const TOOLS: { id: ToolId; label: string; key: string; glyph: string }[] = [
  { id: 'select', label: 'Select', key: 'V', glyph: '⌖' },
  { id: 'text', label: 'Text', key: 'T', glyph: 'T' },
  { id: 'rect', label: 'Rectangle', key: 'R', glyph: '▭' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', glyph: '◯' },
  { id: 'triangle', label: 'Triangle', key: 'Y', glyph: '△' },
  { id: 'line', label: 'Line', key: 'L', glyph: '╱' },
  { id: 'arrow', label: 'Arrow', key: 'A', glyph: '↗' },
];

interface Props {
  onExport(): void;
  exporting: boolean;
  onCloseDoc(): void;
  onInsertImage(file: File): void;
}

export function Toolbar({ onExport, exporting, onCloseDoc, onInsertImage }: Props) {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const title = useStore((s) => s.doc?.title ?? '');
  const setTitle = useStore((s) => s.setTitle);

  // Local while typing so an intermediate empty field is not immediately
  // rewritten to "Untitled" under the cursor; committed on blur or Enter.
  const [draft, setDraft] = useState(title);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(title);
  }, [title]);

  const commit = () => {
    editing.current = false;
    setTitle(draft);
    setDraft(normaliseTitle(draft));
  };

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-edge bg-surface px-3 py-2">
      <button
        type="button"
        onClick={onCloseDoc}
        title="Save and return to your documents"
        aria-label="Back to documents"
        className="mr-2 rounded-md px-2 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100"
      >
        ← Documents
      </button>

      <input
        value={draft}
        onChange={(e) => {
          editing.current = true;
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            editing.current = false;
            setDraft(title);
            e.currentTarget.blur();
          }
        }}
        title="Rename this document"
        aria-label="Document title"
        placeholder="Untitled"
        className="mr-3 w-44 truncate rounded-md border border-transparent px-2 py-1 text-sm font-medium text-slate-700 transition-colors hover:border-edge focus:border-accent focus:bg-white focus:outline-none"
      />

      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
          className={`h-8 w-8 rounded-md text-sm transition-colors ${
            tool === t.id ? 'bg-accent text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {t.glyph}
        </button>
      ))}

      <label
        title="Insert an image"
        aria-label="Insert an image"
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-sm text-slate-600 transition-colors hover:bg-slate-100"
      >
        ▣
        <input
          type="file"
          accept={`image/*,${EXTRA_IMAGE_EXTENSIONS}`}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onInsertImage(file);
            // Reset so the same file can be inserted twice in a row.
            e.target.value = '';
          }}
        />
      </label>

      <Divider />

      <IconButton label="Undo (Ctrl+Z)" onClick={undo}>
        ↶
      </IconButton>
      <IconButton label="Redo (Ctrl+Y)" onClick={redo}>
        ↷
      </IconButton>

      <Divider />

      <IconButton label="Zoom out" onClick={() => setZoom(zoom - 0.25)}>
        −
      </IconButton>
      <span className="w-12 text-center text-xs tabular-nums text-slate-500">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton label="Zoom in" onClick={() => setZoom(zoom + 0.25)}>
        +
      </IconButton>

      <div className="ml-auto" />

      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {exporting ? 'Exporting…' : 'Export PDF'}
      </button>
    </div>
  );
}

const Divider = () => <div className="mx-2 h-6 w-px bg-edge" />;

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="h-8 w-8 rounded-md text-slate-600 transition-colors hover:bg-slate-100"
    >
      {children}
    </button>
  );
}
