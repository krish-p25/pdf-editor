import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react';
import { nextId, useStore } from '../model/store';
import { displayToPage } from '../geometry/coords';
import { arrowHead, constrainTo45, lineFromPoints, type Point } from '../geometry/lines';
import {
  clampCrop,
  dragCropEdge,
  preserveAspect,
  recrop,
  sourceFraction,
  type CropState,
} from '../geometry/images';
import { resolveSnap, type SnapIndicator, type SnapTarget } from '../geometry/snapping';
import { SnapIndicators } from './SnapIndicators';
import { ShapeObjectView } from './ShapeObjectView';
import { TextObjectView } from './TextObjectView';
import { ImageObjectView, CropPreview } from './ImageObjectView';
import { objectBoxStyle } from './PageObjects';
import { loadImageFile, looksLikeImage, ImageLoadError } from '../pdf/imageFile';
import {
  isBoxShape,
  isImage,
  isLine,
  isText,
  type BoxShapeKind,
  type BoxShapeObject,
  type EditorObject,
  type LineShapeKind,
  type LineShapeObject,
  type Page,
  type Rect,
  type TextObject,
} from '../model/types';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

type Interaction =
  | { mode: 'create-box'; start: Point }
  | { mode: 'create-line'; start: Point }
  | { mode: 'move'; ids: string[]; start: Point; origins: Record<string, Rect> }
  | { mode: 'resize'; id: string; handle: Handle; origin: Rect }
  | { mode: 'endpoint'; id: string; which: 'start' | 'end'; anchor: Point }
  | { mode: 'rotate'; id: string; centre: Point; startAngle: number; startRotation: number }
  | { mode: 'crop'; id: string; handle: Handle; origin: CropState };

interface Props {
  page: Page;
  zoom: number;
}

/** Snap threshold in SCREEN pixels; converted to points using the zoom. */
const SNAP_THRESHOLD_PX = 6;

/** Minimum drag before a new object is kept, in points. */
const MIN_BOX_SIZE = 3;
const MIN_LINE_LENGTH = 4;

const isLineTool = (tool: string): tool is LineShapeKind => tool === 'line' || tool === 'arrow';

export function ObjectLayer({ page, zoom }: Props) {
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const addObject = useStore((s) => s.addObject);
  const updateObjectTransient = useStore((s) => s.updateObjectTransient);
  const commitInteraction = useStore((s) => s.commitInteraction);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const editingId = useStore((s) => s.editingObjectId);
  const editSelectAll = useStore((s) => s.editSelectAll);
  const beginEditing = useStore((s) => s.beginEditing);
  const endEditing = useStore((s) => s.endEditing);
  const croppingId = useStore((s) => s.croppingObjectId);
  const addImageAt = useStore((s) => s.addImageAt);
  const setError = useStore((s) => s.setError);

  const layer = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const [indicators, setIndicators] = useState<SnapIndicator[]>([]);

  // Refs are the source of truth; the state copies exist only to render the
  // preview. If pointerup lands in the same tick as the last pointermove,
  // React's batching would leave a state copy stale and the new object would
  // be silently discarded.
  const draftRef = useRef<Rect | null>(null);
  const [draft, setDraftState] = useState<Rect | null>(null);
  const setDraft = useCallback((r: Rect | null) => {
    draftRef.current = r;
    setDraftState(r);
  }, []);

  const lineDraftRef = useRef<{ start: Point; end: Point } | null>(null);
  const [lineDraft, setLineDraftState] = useState<{ start: Point; end: Point } | null>(null);
  const setLineDraft = useCallback((l: { start: Point; end: Point } | null) => {
    lineDraftRef.current = l;
    setLineDraftState(l);
  }, []);

  const objects = (
    doc ? page.objectIds.map((id) => doc.objects[id]).filter(Boolean) : []
  ) as EditorObject[];

  /**
   * Convert a pointer event into unrotated page coordinates.
   *
   * Measured against the unrotated page root, then passed through
   * displayToPage so a rotated page still drags in the direction the user
   * expects.
   */
  const toPage = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const root = layer.current?.closest('[data-page-root]');
      if (!root) return { x: 0, y: 0 };
      const box = root.getBoundingClientRect();
      const display = { x: (e.clientX - box.left) / zoom, y: (e.clientY - box.top) / zoom };
      return displayToPage(display, page);
    },
    [zoom, page],
  );

  const snapFor = useCallback(
    (moving: Rect, excludeIds: string[], altKey: boolean) => {
      const targets: SnapTarget[] = objects
        .filter((o) => !excludeIds.includes(o.id))
        .map((o) => ({ id: o.id, rect: { x: o.x, y: o.y, width: o.width, height: o.height } }));

      return resolveSnap(moving, targets, {
        threshold: SNAP_THRESHOLD_PX / zoom,
        page: { width: page.width, height: page.height },
        enabled: snapEnabled && !altKey,
      });
    },
    [objects, zoom, page.width, page.height, snapEnabled],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    if (tool !== 'select') {
      const start = toPage(e);
      e.currentTarget.setPointerCapture(e.pointerId);

      if (isLineTool(tool)) {
        // A line is two points, not a box: press marks the first point and
        // release marks the second.
        interaction.current = { mode: 'create-line', start };
        setLineDraft({ start, end: start });
      } else {
        interaction.current = { mode: 'create-box', start };
        setDraft({ x: start.x, y: start.y, width: 0, height: 0 });
      }
      return;
    }

    // Clicking bare canvas clears the selection.
    if (e.target === layer.current) select([]);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = interaction.current;
    if (!current) return;
    const p = toPage(e);

    if (current.mode === 'create-line') {
      setLineDraft({ start: current.start, end: e.shiftKey ? constrainTo45(current.start, p) : p });
      return;
    }

    if (current.mode === 'endpoint') {
      const end = e.shiftKey ? constrainTo45(current.anchor, p) : p;
      const from = current.which === 'end' ? current.anchor : end;
      const to = current.which === 'end' ? end : current.anchor;
      updateObjectTransient(current.id, lineFromPoints(from, to));
      return;
    }

    if (current.mode === 'rotate') {
      const angle = (Math.atan2(p.y - current.centre.y, p.x - current.centre.x) * 180) / Math.PI;
      let rotation = current.startRotation + (angle - current.startAngle);
      // Shift snaps to 15 degrees, the usual increment for straightening a
      // scan or squaring something up by eye.
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
      updateObjectTransient(current.id, { rotation: ((rotation % 360) + 360) % 360 });
      return;
    }

    if (current.mode === 'crop') {
      // Everything is worked out from the state at the start of the drag, as
      // resize does: the box changes as the crop does, so measuring against
      // the live box would drift. The box and the crop move together, so the
      // kept part of the image stays the same size and on the same spot.
      const at = sourceFraction(current.origin, p);
      const crop = dragCropEdge(current.origin.crop, current.handle, at);
      updateObjectTransient(current.id, { ...recrop(current.origin, crop), crop });
      return;
    }

    if (current.mode === 'create-box') {
      let rect = normalise(current.start, p);
      if (e.shiftKey) rect = constrainSquare(current.start, rect);
      setDraft(rect);
      return;
    }

    if (current.mode === 'move') {
      const dx = p.x - current.start.x;
      const dy = p.y - current.start.y;
      const primary = current.ids[0];
      const origin = current.origins[primary];
      if (!origin) return;

      const moved: Rect = { ...origin, x: origin.x + dx, y: origin.y + dy };
      const snapped = snapFor(moved, current.ids, e.altKey);
      setIndicators(snapped.indicators);

      // Apply the SNAPPED delta to every selected object so a group moves
      // together and keeps its internal spacing.
      const sdx = snapped.rect.x - origin.x;
      const sdy = snapped.rect.y - origin.y;
      for (const id of current.ids) {
        const o = current.origins[id];
        if (o) updateObjectTransient(id, { x: o.x + sdx, y: o.y + sdy });
      }
      return;
    }

    if (current.mode === 'resize') {
      const obj0 = doc?.objects[current.id];
      // An image distorted by a careless corner drag is almost never wanted,
      // so the ratio holds by default and Shift releases it — the opposite of
      // the shape tools, where free-form is the norm.
      const keepAspect =
        obj0 !== undefined && isImage(obj0) && !e.shiftKey && current.handle.length === 2;
      const resized = keepAspect
        ? preserveAspect(
            current.origin,
            current.handle,
            p,
            current.origin.width / Math.max(current.origin.height, 0.001),
          )
        : applyHandle(current.origin, current.handle, p);
      const snapped = snapFor(resized, [current.id], e.altKey);
      setIndicators(snapped.indicators);

      const obj = doc?.objects[current.id];
      // A text object's height is derived from its layout, so only width is
      // user-controlled.
      const patch =
        obj && isText(obj)
          ? { x: snapped.rect.x, y: snapped.rect.y, width: Math.max(12, snapped.rect.width) }
          : {
              x: snapped.rect.x,
              y: snapped.rect.y,
              width: Math.max(2, snapped.rect.width),
              height: Math.max(2, snapped.rect.height),
            };
      updateObjectTransient(current.id, patch);
    }
  };

  const onPointerUp = () => {
    const current = interaction.current;

    if (current?.mode === 'create-line') {
      const line = lineDraftRef.current;
      if (line && Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) >= MIN_LINE_LENGTH) {
        createLine(line.start, line.end);
      }
      setLineDraft(null);
      setTool('select');
    } else if (current?.mode === 'create-box') {
      const rect = draftRef.current;
      if (rect && rect.width >= MIN_BOX_SIZE && rect.height >= MIN_BOX_SIZE) createBox(rect);
      setDraft(null);
      setTool('select');
    } else if (current) {
      commitInteraction();
    }

    interaction.current = null;
    setIndicators([]);
  };

  const createLine = (start: Point, end: Point) => {
    if (!isLineTool(tool)) return;
    const o: LineShapeObject = {
      id: nextId('obj'),
      pageId: page.id,
      kind: tool,
      ...lineFromPoints(start, end),
      stroke: '#1d4ed8',
      strokeWidth: 2,
      strokeOpacity: 1,
      ...(tool === 'arrow' ? { arrowHeadSize: 10 } : {}),
    };
    addObject(o);
  };

  const createBox = (rect: Rect) => {
    const id = nextId('obj');

    if (tool === 'text') {
      const o: TextObject = {
        id,
        pageId: page.id,
        kind: 'text',
        ...rect,
        text: 'Text',
        fontSize: 14,
        color: '#111111',
        bold: false,
        italic: false,
        align: 'left',
        lineHeight: 1.3,
      };
      addObject(o);
      beginEditing(id, true);
      return;
    }

    const o: BoxShapeObject = {
      id,
      pageId: page.id,
      kind: tool as BoxShapeKind,
      ...rect,
      fill: '#bfdbfe',
      fillOpacity: 1,
      stroke: '#1d4ed8',
      strokeWidth: 2,
      strokeOpacity: 1,
      ...(tool === 'rect' ? { cornerRadius: 0 } : {}),
    };
    addObject(o);
  };

  const beginMove = (e: PointerEvent<HTMLDivElement>, o: EditorObject) => {
    if (tool !== 'select' || editingId === o.id) return;
    e.stopPropagation();

    const ids = e.shiftKey
      ? Array.from(new Set([...selection, o.id]))
      : selection.includes(o.id)
        ? selection
        : [o.id];
    select(ids);

    const origins: Record<string, Rect> = {};
    for (const id of ids) {
      const t = doc?.objects[id];
      if (t) origins[id] = { x: t.x, y: t.y, width: t.width, height: t.height };
    }
    // The primary object must be first: its origin drives the snap result.
    const ordered = [o.id, ...ids.filter((id) => id !== o.id)];

    interaction.current = { mode: 'move', ids: ordered, start: toPage(e), origins };
    layer.current?.setPointerCapture(e.pointerId);
  };

  const beginEndpointDrag = (
    e: PointerEvent<HTMLDivElement>,
    o: LineShapeObject,
    which: 'start' | 'end',
  ) => {
    e.stopPropagation();
    // The opposite end stays put and anchors any 45-degree constraint.
    const anchor =
      which === 'end'
        ? { x: o.x + o.x1, y: o.y + o.y1 }
        : { x: o.x + o.x2, y: o.y + o.y2 };
    interaction.current = { mode: 'endpoint', id: o.id, which, anchor };
    layer.current?.setPointerCapture(e.pointerId);
  };

  // dragenter/dragleave fire for every child element, so a plain boolean
  // would flicker as the pointer crosses objects on the page. Counting
  // enter/leave pairs tracks the page as a whole.
  const dragDepth = useRef(0);
  const [dropActive, setDropActive] = useState(false);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropActive(true);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    // Without preventDefault the browser refuses the drop and opens the file.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);

    const files = Array.from(e.dataTransfer.files);
    const images = files.filter(looksLikeImage);

    if (images.length === 0) {
      setError(
        files.some((f) => f.type === 'application/pdf')
          ? 'To add a PDF, use Import PDF in the page list.'
          : 'Only image files can be dropped onto a page.',
      );
      return;
    }

    const at = toPage(e);
    setError(null);
    for (let i = 0; i < images.length; i++) {
      try {
        // Cascade multiple drops so they do not land exactly on top of
        // each other and look like a single image.
        addImageAt(await loadImageFile(images[i]), { x: at.x + i * 12, y: at.y + i * 12 });
      } catch (err) {
        setError(err instanceof ImageLoadError ? err.message : 'That image could not be added.');
      }
    }
  };

  return (
    <div
      ref={layer}
      className="absolute inset-0"
      style={{
        cursor: tool === 'select' ? 'default' : 'crosshair',
        // With the select tool, a finger on empty page space scrolls, as on
        // any page. With a drawing tool the same gesture draws, so the
        // browser must not claim it as a scroll.
        touchAction: tool === 'select' ? 'pan-x pan-y' : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
    >
      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent/10 ring-2 ring-accent">
          <span className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white shadow">
            Drop image here
          </span>
        </div>
      )}
      {objects.map((o) => {
        const selected = selection.includes(o.id);
        const line = isLine(o) ? o : null;

        return (
          <div
            key={o.id}
            className="absolute"
            style={{
              // Shared with the thumbnails so placement cannot drift.
              ...objectBoxStyle(o, zoom),
              cursor: tool !== 'select' ? 'crosshair' : isText(o) ? 'text' : 'move',
              // A finger on an object moves it rather than scrolling the
              // page. touch-action is the intersection along the ancestor
              // chain, so this also covers every handle inside the object.
              touchAction: 'none',
            }}
            onPointerDown={(e) => beginMove(e, o)}
            onDoubleClick={(e) => {
              // While the box is already open, a double-click is the user
              // selecting a word inside the textarea. Leave it alone.
              if (isText(o) && editingId !== o.id) {
                e.stopPropagation();
                beginEditing(o.id, false);
              }
            }}
            title={isText(o) ? 'Double-click to edit text' : undefined}
          >
            {isText(o) ? (
              <TextObjectView
                o={o}
                zoom={zoom}
                editing={editingId === o.id}
                selectAll={editSelectAll}
                onFinishEditing={() => {
                  endEditing();
                  commitInteraction();
                }}
              />
            ) : isImage(o) ? (
              croppingId === o.id ? (
                <CropPreview o={o} zoom={zoom} />
              ) : (
                <ImageObjectView o={o} zoom={zoom} />
              )
            ) : (
              <ShapeObjectView o={o} zoom={zoom} />
            )}

            {selected && editingId !== o.id && line && (
              // A line is adjusted by its two ends, not by a bounding box.
              <>
                <EndpointHandle
                  x={line.x1 * zoom}
                  y={line.y1 * zoom}
                  label="Move line start"
                  onPointerDown={(e) => beginEndpointDrag(e, line, 'start')}
                />
                <EndpointHandle
                  x={line.x2 * zoom}
                  y={line.y2 * zoom}
                  label="Move line end"
                  onPointerDown={(e) => beginEndpointDrag(e, line, 'end')}
                />
              </>
            )}

            {selected && croppingId === o.id && isImage(o) && (
              <>
                {HANDLES.map((h) => (
                  <div
                    key={h}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      interaction.current = {
                        mode: 'crop',
                        id: o.id,
                        handle: h,
                        origin: {
                          box: { x: o.x, y: o.y, width: o.width, height: o.height },
                          crop: clampCrop(o.crop),
                          rotation: o.rotation,
                        },
                      };
                      layer.current?.setPointerCapture(e.pointerId);
                    }}
                    className={`absolute h-2.5 w-2.5 border-2 border-accent bg-white ${TOUCH_TARGET}`}
                    style={{ ...handlePosition(h), cursor: `${h}-resize` }}
                  />
                ))}
              </>
            )}

            {selected && editingId !== o.id && croppingId !== o.id && !line && (
              <>
                <div className="pointer-events-none absolute -inset-px ring-1 ring-accent" />

                {isImage(o) && (
                  <RotateHandle
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const centre = { x: o.x + o.width / 2, y: o.y + o.height / 2 };
                      const at = toPage(e);
                      interaction.current = {
                        mode: 'rotate',
                        id: o.id,
                        centre,
                        startAngle: (Math.atan2(at.y - centre.y, at.x - centre.x) * 180) / Math.PI,
                        startRotation: o.rotation,
                      };
                      layer.current?.setPointerCapture(e.pointerId);
                    }}
                  />
                )}
                {HANDLES.map((h) => (
                  <div
                    key={h}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      interaction.current = {
                        mode: 'resize',
                        id: o.id,
                        handle: h,
                        origin: { x: o.x, y: o.y, width: o.width, height: o.height },
                      };
                      layer.current?.setPointerCapture(e.pointerId);
                    }}
                    className={`absolute h-2 w-2 rounded-sm border border-accent bg-white ${TOUCH_TARGET}`}
                    style={{ ...handlePosition(h), cursor: `${h}-resize` }}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}

      {draft && (
        <div
          className="pointer-events-none absolute border border-dashed border-accent bg-accent/10"
          style={{
            left: draft.x * zoom,
            top: draft.y * zoom,
            width: draft.width * zoom,
            height: draft.height * zoom,
          }}
        />
      )}

      {lineDraft && isLineTool(tool) && (
        <LinePreview start={lineDraft.start} end={lineDraft.end} kind={tool} zoom={zoom} />
      )}

      <SnapIndicators indicators={indicators} zoom={zoom} />
    </div>
  );
}

/**
 * Half-opacity preview of the line being drawn, so the user can see exactly
 * where it will land — including which end gets the arrow head — before
 * releasing the button.
 */
function LinePreview({
  start,
  end,
  kind,
  zoom,
}: {
  start: Point;
  end: Point;
  kind: LineShapeKind;
  zoom: number;
}) {
  const a = { x: start.x * zoom, y: start.y * zoom };
  const b = { x: end.x * zoom, y: end.y * zoom };
  const head = kind === 'arrow' ? arrowHead(a, b, 10 * zoom) : null;
  const shaftEnd = head ? head.shaftEnd : b;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" style={{ opacity: 0.5 }}>
      <line
        x1={a.x}
        y1={a.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke="#1d4ed8"
        strokeWidth={2 * zoom}
        strokeLinecap="round"
      />
      {head && (
        <polygon
          points={`${head.tip.x},${head.tip.y} ${head.left.x},${head.left.y} ${head.right.x},${head.right.y}`}
          fill="#1d4ed8"
        />
      )}
    </svg>
  );
}

/**
 * Enlarges a handle's hit area on a touchscreen without changing how it looks.
 *
 * Handles are drawn 8-20px across, which suits a mouse pointer but is far
 * smaller than a fingertip. An invisible pseudo-element extends each one by
 * 16px on every side, but only where the primary pointer is coarse, so mouse
 * users keep precise handles that do not crowd each other on small objects.
 */
const TOUCH_TARGET =
  "[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-4 [@media(pointer:coarse)]:before:content-['']";

function RotateHandle({
  onPointerDown,
}: {
  onPointerDown(e: PointerEvent<HTMLDivElement>): void;
}) {
  return (
    <div
      role="button"
      aria-label="Rotate image"
      title="Drag to rotate · hold Shift for 15° steps"
      onPointerDown={onPointerDown}
      className={`absolute left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-accent bg-white text-[10px] text-accent shadow-sm ${TOUCH_TARGET}`}
      style={{ top: -28, cursor: 'grab' }}
    >
      ⟳
    </div>
  );
}

function EndpointHandle({
  x,
  y,
  label,
  onPointerDown,
}: {
  x: number;
  y: number;
  label: string;
  onPointerDown(e: PointerEvent<HTMLDivElement>): void;
}) {
  return (
    <div
      role="button"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      className={`absolute h-2.5 w-2.5 rounded-full border-2 border-accent bg-white ${TOUCH_TARGET}`}
      style={{ left: x - 5, top: y - 5, cursor: 'crosshair' }}
    />
  );
}

function normalise(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Shift while drawing a box constrains it to a square, anchored at `start`. */
function constrainSquare(start: Point, r: Rect): Rect {
  const size = Math.max(r.width, r.height);
  return {
    width: size,
    height: size,
    x: r.x < start.x ? start.x - size : start.x,
    y: r.y < start.y ? start.y - size : start.y,
  };
}

function applyHandle(o: Rect, h: Handle, p: Point): Rect {
  let { x, y, width, height } = o;
  if (h.includes('w')) {
    width = o.x + o.width - p.x;
    x = p.x;
  }
  if (h.includes('e')) width = p.x - o.x;
  if (h.includes('n')) {
    height = o.y + o.height - p.y;
    y = p.y;
  }
  if (h.includes('s')) height = p.y - o.y;
  return { x, y, width, height };
}

function handlePosition(h: Handle): CSSProperties {
  const vertical = h.includes('n')
    ? { top: -4 }
    : h.includes('s')
      ? { bottom: -4 }
      : { top: 'calc(50% - 4px)' };
  const horizontal = h.includes('w')
    ? { left: -4 }
    : h.includes('e')
      ? { right: -4 }
      : { left: 'calc(50% - 4px)' };
  return { ...vertical, ...horizontal };
}

// Re-exported for the properties panel's narrowing.
export { isBoxShape };
