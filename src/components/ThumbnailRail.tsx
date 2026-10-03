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
import { displaySize } from '../geometry/coords';
import { fitWithin } from '../geometry/images';
import { PageObjects } from './PageObjects';
import { useStore } from '../model/store';
import type { EditorObject, Page } from '../model/types';

interface Props {
  proxy: PDFDocumentProxy;
  onImportPdfs(files: File[]): void;
}

/** Usable area of a thumbnail inside the rail, in CSS pixels. */
const THUMBNAIL_WIDTH_PX = 140;
const THUMBNAIL_HEIGHT_PX = 186;

export function ThumbnailRail({ proxy, onImportPdfs }: Props) {
  const doc = useStore((s) => s.doc);
  const activePageId = useStore((s) => s.activePageId);
  const setActivePage = useStore((s) => s.setActivePage);
  const reorderPages = useStore((s) => s.reorderPages);
  const addBlankPage = useStore((s) => s.addBlankPage);

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
              objects={page.objectIds.map((id) => doc.objects[id]).filter(Boolean) as EditorObject[]}
              index={i}
              active={page.id === activePageId}
              canDelete={doc.pages.length > 1}
              onSelect={() => setActivePage(page.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <label
        title="Add every page of one or more PDFs to the end of this document"
        className="shrink-0 cursor-pointer rounded-lg border-2 border-dashed border-edge py-3 text-center text-sm text-slate-500 transition-colors hover:border-accent hover:text-accent"
      >
        + Import PDF
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onImportPdfs(files);
            // Reset so the same files can be imported again.
            e.target.value = '';
          }}
        />
      </label>

      <button
        type="button"
        onClick={addBlankPage}
        title="Add a blank page at the end, matching the last page's size"
        className="mt-1 shrink-0 rounded-lg border-2 border-dashed border-edge py-3 text-sm text-slate-500 transition-colors hover:border-accent hover:text-accent"
      >
        + Add page
      </button>
    </div>
  );
}

interface ThumbProps {
  proxy: PDFDocumentProxy;
  page: Page;
  objects: EditorObject[];
  index: number;
  active: boolean;
  canDelete: boolean;
  onSelect(): void;
}

function Thumbnail({ proxy, page, objects, index, active, canDelete, onSelect }: ThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const deletePage = useStore((s) => s.deletePage);
  const rotatePage = useStore((s) => s.rotatePage);
  const [src, setSrc] = useState<string | null>(null);

  // Fit the page into the thumbnail box on BOTH axes, using its rotated size:
  // a landscape or rotated page scaled by width alone would overflow.
  const display = displaySize(page);
  const fitted = fitWithin(display.width, display.height, THUMBNAIL_WIDTH_PX, THUMBNAIL_HEIGHT_PX);
  const cssScale = fitted.width / Math.max(display.width, 0.001);

  // Thumbnails render lazily and the render cache keeps a long document from
  // stalling on load.
  useEffect(() => {
    if (page.sourceIndex === null) {
      setSrc(null);
      return;
    }

    let cancelled = false;
    const sourceIndex = page.sourceIndex;
    renderPage(proxy, sourceIndex, cssScale)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [proxy, page.sourceIndex, cssScale]);

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
          {/*
            Mirrors PageCanvas: an outer box in display space, an inner box in
            page space carrying the rotation, with the raster and the objects
            both inside. That is what lets objects sit over the page correctly
            once it is rotated.
          */}
          <div
            className="relative bg-white"
            style={{ width: display.width * cssScale, height: display.height * cssScale }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left overflow-hidden"
              style={{
                width: page.width * cssScale,
                height: page.height * cssScale,
                transform: thumbRotation(
                  page.rotation,
                  page.width * cssScale,
                  page.height * cssScale,
                ),
              }}
            >
              {src && (
                <img
                  src={src}
                  alt={`Page ${index + 1}`}
                  draggable={false}
                  className="h-full w-full select-none"
                />
              )}
              <PageObjects objects={objects} zoom={cssScale} />
            </div>

            {page.sourceIndex === null && objects.length === 0 && (
              <span className="absolute inset-0 flex items-center justify-center text-xs italic text-slate-300">
                Blank
              </span>
            )}
          </div>
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

/** Rotate about the top-left, then translate so the page sits flush. */
function thumbRotation(rotation: number, w: number, h: number): string | undefined {
  switch (rotation) {
    case 90:
      return `translate(${h}px, 0) rotate(90deg)`;
    case 180:
      return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270:
      return `translate(0, ${w}px) rotate(270deg)`;
    default:
      return undefined;
  }
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
