import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '../pdf/renderPage';
import { useStore } from '../model/store';
import type { Page } from '../model/types';

interface Props {
  proxy: PDFDocumentProxy;
}

/** Usable width of a thumbnail inside the rail, in CSS pixels. */
const THUMBNAIL_WIDTH_PX = 148;

export function ThumbnailRail({ proxy }: Props) {
  const doc = useStore((s) => s.doc);
  const activePageId = useStore((s) => s.activePageId);
  const setActivePage = useStore((s) => s.setActivePage);
  const reorderPages = useStore((s) => s.reorderPages);

  // A small activation distance lets a plain click select without starting a
  // drag, while still making reordering feel immediate.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!doc) return null;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = doc.pages.findIndex((p) => p.id === active.id);
    const to = doc.pages.findIndex((p) => p.id === over.id);
    if (from >= 0 && to >= 0) reorderPages(from, to);
  };

  return (
    <div className="flex h-full w-44 shrink-0 flex-col gap-2 overflow-y-auto border-r border-edge bg-panel p-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={doc.pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {doc.pages.map((page, i) => (
            <Thumbnail
              key={page.id}
              proxy={proxy}
              page={page}
              index={i}
              active={page.id === activePageId}
              canDelete={doc.pages.length > 1}
              onSelect={() => setActivePage(page.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface ThumbProps {
  proxy: PDFDocumentProxy;
  page: Page;
  index: number;
  active: boolean;
  canDelete: boolean;
  onSelect(): void;
}

function Thumbnail({ proxy, page, index, active, canDelete, onSelect }: ThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const deletePage = useStore((s) => s.deletePage);
  const rotatePage = useStore((s) => s.rotatePage);
  const [src, setSrc] = useState<string | null>(null);

  // Scale to the box the thumbnail actually occupies rather than a fixed
  // factor, so pages of any size fill it at the right resolution. renderPage
  // applies the device pixel ratio on top.
  const cssScale = THUMBNAIL_WIDTH_PX / page.width;

  // Thumbnails render lazily and the render cache keeps a long document from
  // stalling on load.
  useEffect(() => {
    let cancelled = false;
    renderPage(proxy, page.sourceIndex, cssScale)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [proxy, page.sourceIndex, cssScale]);

  const swapped = page.rotation === 90 || page.rotation === 270;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative ${isDragging ? 'z-10 opacity-80' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        {...attributes}
        {...listeners}
        className={`block w-full overflow-hidden rounded-lg border-2 bg-white transition-colors ${
          active ? 'border-accent' : 'border-edge hover:border-slate-400'
        }`}
      >
        <div className="flex aspect-[3/4] items-center justify-center overflow-hidden p-1">
          {src && (
            <img
              src={src}
              alt={`Page ${index + 1}`}
              draggable={false}
              className="select-none"
              style={{
                transform: `rotate(${page.rotation}deg)`,
                maxHeight: swapped ? '72%' : '100%',
                maxWidth: swapped ? '72%' : '100%',
              }}
            />
          )}
        </div>
        <div className="border-t border-edge py-1 text-center text-xs text-slate-500">
          {index + 1}
        </div>
      </button>

      <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
        <IconButton label="Rotate left" onClick={() => rotatePage(page.id, -90)}>
          ⟲
        </IconButton>
        <IconButton label="Rotate right" onClick={() => rotatePage(page.id, 90)}>
          ⟳
        </IconButton>
        {canDelete && (
          <IconButton label="Delete page" danger onClick={() => deletePage(page.id)}>
            ✕
          </IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-5 w-5 items-center justify-center rounded bg-white/95 text-xs shadow ring-1 ring-edge ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
