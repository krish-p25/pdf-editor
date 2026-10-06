import type { ReactNode } from 'react';

interface Props {
  side: 'left' | 'right';
  open: boolean;
  /** Phone-width layout: the panel slides over the page instead of sitting beside it. */
  narrow: boolean;
  onClose(): void;
  /** Names the drawer for assistive technology, and titles it on a phone. */
  label: string;
  children: ReactNode;
}

/**
 * A collapsible side panel.
 *
 * On a wide screen it sits in the layout beside the page, and collapsing it
 * removes it so the page gets the room. On a phone there is no room to give,
 * so it becomes a drawer that slides over the page, with a backdrop that
 * closes it on tap.
 *
 * A closed drawer stays mounted, so it can slide back out without rebuilding
 * its contents, but it is made `inert` so its buttons cannot be reached by
 * keyboard or screen reader while it is off-screen.
 */
export function SidePanel({ side, open, narrow, onClose, label, children }: Props) {
  if (!narrow) return open ? <>{children}</> : null;

  const offscreen = side === 'left' ? '-translate-x-full' : 'translate-x-full';

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30"
          onClick={onClose}
          data-testid={`${side}-backdrop`}
        />
      )}
      <div
        role="dialog"
        aria-label={label}
        aria-hidden={!open}
        {...(open ? {} : { inert: '' })}
        className={`fixed inset-y-0 z-40 flex max-w-[85vw] flex-col bg-panel shadow-xl transition-transform duration-200 ${
          side === 'left' ? 'left-0' : 'right-0'
        } ${open ? 'translate-x-0' : offscreen}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${label.toLowerCase()}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </>
  );
}
