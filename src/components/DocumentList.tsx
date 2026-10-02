import { useState } from 'react';
import type { DocumentSummary } from '../model/persistence';

interface Props {
  documents: DocumentSummary[];
  onOpen(id: string): void;
  onDelete(id: string): void;
}

/** "3 minutes ago", "yesterday", "12 Mar" — whichever reads best. */
export function describeSaved(savedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  return new Date(savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function DocumentList({ documents, onOpen, onDelete }: Props) {
  // Deleting a document is permanent, so the button asks for a second click
  // rather than interrupting with a modal.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (documents.length === 0) return null;

  return (
    <div className="mt-8 w-full max-w-xl">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Your documents
      </h2>

      <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface">
        {documents.map((d) => (
          <li key={d.id} className="group flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => onOpen(d.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-sm font-medium text-slate-800">{d.title}</div>
              <div className="text-xs text-slate-400">
                {d.pageCount} page{d.pageCount === 1 ? '' : 's'} · edited {describeSaved(d.savedAt)}
              </div>
            </button>

            {confirmingId === d.id ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(d.id);
                    setConfirmingId(null);
                  }}
                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingId(d.id)}
                title={`Delete ${d.title}`}
                aria-label={`Delete ${d.title}`}
                className="shrink-0 rounded-md px-2 py-1 text-sm text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-slate-400">
        Saved in this browser only — they are not uploaded anywhere.
      </p>
    </div>
  );
}
