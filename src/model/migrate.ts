import type { Doc, EditorObject, LineShapeObject, ObjectId } from './types';

/**
 * Bring a document loaded from storage or a backup up to the current schema.
 *
 * Lines and arrows used to be stored as a plain bounding box and were always
 * drawn along the box's bottom-left to top-right diagonal. They are now
 * defined by two explicit endpoints. Any object saved before that change has
 * no endpoints, so they are reconstructed from the old drawing rule — which
 * makes existing documents render exactly as they did before.
 *
 * Migration is idempotent: an object that already has endpoints is untouched.
 */
export function migrateDoc(doc: Doc): Doc {
  const objects: Record<ObjectId, EditorObject> = {};
  for (const [id, o] of Object.entries(doc.objects)) {
    objects[id] = migrateObject(o);
  }
  return { ...doc, objects };
}

function migrateObject(o: EditorObject): EditorObject {
  if (o.kind !== 'line' && o.kind !== 'arrow') return o;

  const line = o as Partial<LineShapeObject> & EditorObject;
  const hasEndpoints =
    typeof line.x1 === 'number' &&
    typeof line.y1 === 'number' &&
    typeof line.x2 === 'number' &&
    typeof line.y2 === 'number';
  if (hasEndpoints) return o;

  // The old renderer always drew bottom-left to top-right within the box.
  const legacy = o as unknown as Record<string, unknown>;
  const migrated: LineShapeObject = {
    id: o.id,
    pageId: o.pageId,
    kind: o.kind,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    x1: 0,
    y1: o.height,
    x2: o.width,
    y2: 0,
    stroke: typeof legacy.stroke === 'string' ? legacy.stroke : '#1d4ed8',
    strokeWidth: typeof legacy.strokeWidth === 'number' ? legacy.strokeWidth : 2,
    strokeOpacity: typeof legacy.strokeOpacity === 'number' ? legacy.strokeOpacity : 1,
    ...(typeof legacy.arrowHeadSize === 'number'
      ? { arrowHeadSize: legacy.arrowHeadSize }
      : o.kind === 'arrow'
        ? { arrowHeadSize: 10 }
        : {}),
  };
  return migrated;
}
