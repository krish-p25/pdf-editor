import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { nextId, useStore } from '../model/store';
import { displayToPage } from '../geometry/coords';
import { resolveSnap, type SnapIndicator, type SnapTarget } from '../geometry/snapping';
import { SnapIndicators } from './SnapIndicators';
import { ShapeObjectView } from './ShapeObjectView';
import { TextObjectView } from './TextObjectView';
import {
  isText,
  type EditorObject,
  type Page,
  type Rect,
  type ShapeKind,
  type ShapeObject,
  type TextObject,
} from '../model/types';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

interface Point {
  x: number;
  y: number;
}

type Interaction =
  | { mode: 'create'; start: Point }
  | { mode: 'move'; ids: string[]; start: Point; origins: Record<string, Rect> }
  | { mode: 'resize'; id: string; handle: Handle; origin: Rect };

interface Props {
  page: Page;
  zoom: number;
}

/** Snap threshold in SCREEN pixels; converted to points using the zoom. */
const SNAP_THRESHOLD_PX = 6;

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

  const layer = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const [indicators, setIndicators] = useState<SnapIndicator[]>([]);

  // The ref is the source of truth; the state copy exists only to render the
  // dashed preview. If pointerup lands in the same tick as the last
  // pointermove, React's batching would leave the state copy stale and the
  // new object would be silently discarded.
  const draftRef = useRef<Rect | null>(null);
  const [draft, setDraftState] = useState<Rect | null>(null);
  const setDraft = useCallback((r: Rect | null) => {
    draftRef.current = r;
    setDraftState(r);
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
      interaction.current = { mode: 'create', start };
      setDraft({ x: start.x, y: start.y, width: 0, height: 0 });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Clicking bare canvas clears the selection.
    if (e.target === layer.current) select([]);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = interaction.current;
    if (!current) return;
    const p = toPage(e);

    if (current.mode === 'create') {
      let rect = normalise(current.start, p);
      if (e.shiftKey) {
        rect =
          tool === 'line' || tool === 'arrow'
            ? constrainAngle(current.start, p)
            : constrainSquare(current.start, rect);
      }
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
      const resized = applyHandle(current.origin, current.handle, p);
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
    if (current?.mode === 'create') {
      const rect = draftRef.current;
      if (rect && rect.width >= 3 && rect.height >= 3) createObject(rect);
      setDraft(null);
      setTool('select');
    } else if (current) {
      commitInteraction();
    }
    interaction.current = null;
    setIndicators([]);
  };

  const createObject = (rect: Rect) => {
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

    const strokeOnly = tool === 'line' || tool === 'arrow';
    const o: ShapeObject = {
      id,
      pageId: page.id,
      kind: tool as ShapeKind,
      ...rect,
      fill: strokeOnly ? 'none' : '#bfdbfe',
      fillOpacity: 1,
      stroke: '#1d4ed8',
      strokeWidth: 2,
      strokeOpacity: 1,
      cornerRadius: tool === 'rect' ? 0 : undefined,
      arrowHeadSize: tool === 'arrow' ? 10 : undefined,
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

  return (
    <div
      ref={layer}
      className="absolute inset-0"
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {objects.map((o) => {
        const selected = selection.includes(o.id);
        return (
          <div
            key={o.id}
            className="absolute"
            style={{
              left: o.x * zoom,
              top: o.y * zoom,
              width: o.width * zoom,
              height: o.height * zoom,
              cursor: tool !== 'select' ? 'crosshair' : isText(o) ? 'text' : 'move',
            }}
            onPointerDown={(e) => beginMove(e, o)}
            onDoubleClick={(e) => {
              if (isText(o)) {
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
            ) : (
              <ShapeObjectView o={o} zoom={zoom} />
            )}

            {selected && editingId !== o.id && (
              <>
                <div className="pointer-events-none absolute -inset-px ring-1 ring-accent" />
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
                    className="absolute h-2 w-2 rounded-sm border border-accent bg-white"
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

      <SnapIndicators indicators={indicators} zoom={zoom} />
    </div>
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

/**
 * Shift while drawing a LINE or ARROW should constrain it to 45-degree
 * increments, the way it does in Figma, Illustrator and PowerPoint.
 *
 * Lines and arrows are drawn along the bounding box diagonal, from its
 * bottom-left corner to its top-right corner, so the returned rect must
 * describe a box whose diagonal points in the constrained direction.
 */
function constrainAngle(start: Point, current: Point): Rect {
  // TODO(human): constrain the line from `start` to `current` to the nearest
  // 45-degree increment, then return the bounding box via normalise().
  return normalise(start, current);
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
