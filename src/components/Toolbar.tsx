import { useStore } from '../model/store';
import type { ToolId } from '../model/types';

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
  onSaveBackup(): void;
  onLoadBackup(file: File): void;
}

export function Toolbar({ onExport, exporting, onSaveBackup, onLoadBackup }: Props) {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const fileName = useStore((s) => s.doc?.fileName);

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-edge bg-surface px-3 py-2">
      <div className="mr-3 max-w-48 truncate text-sm font-medium text-slate-700" title={fileName}>
        {fileName}
      </div>

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
        onClick={onSaveBackup}
        title="Download all your edits as a .json file you can re-import later"
        className="rounded-md border border-edge px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
      >
        Save backup
      </button>

      <label
        title="Restore edits from a .pdfedit.json backup"
        className="cursor-pointer rounded-md border border-edge px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
      >
        Restore
        <input
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onLoadBackup(file);
            // Reset so picking the same file twice still fires a change event.
            e.target.value = '';
          }}
        />
      </label>

      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="ml-1 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
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
