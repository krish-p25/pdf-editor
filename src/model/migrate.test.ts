import { describe, it, expect } from 'vitest';
import { migrateDoc } from './migrate';
import type { Doc, EditorObject, LineShapeObject } from './types';

/**
 * These protect documents users already have. Lines and arrows saved before
 * the point-to-point rework have no endpoints, and must come back looking
 * exactly as they did: drawn along the box's bottom-left to top-right
 * diagonal.
 */

/** A line/arrow exactly as the old schema stored it. */
const legacyArrow = {
  id: 'a1',
  pageId: 'p1',
  kind: 'arrow',
  x: 100,
  y: 200,
  width: 80,
  height: 60,
  fill: 'none',
  fillOpacity: 1,
  stroke: '#ff0000',
  strokeWidth: 3,
  strokeOpacity: 0.9,
  arrowHeadSize: 12,
} as unknown as EditorObject;

const doc = (objects: Record<string, EditorObject>): Doc => ({
  fileName: 'x.pdf',
  sourceBytes: new Uint8Array([1]),
  pages: [{ id: 'p1', sourceIndex: 0, rotation: 0, width: 600, height: 800, objectIds: Object.keys(objects) }],
  objects,
});

describe('legacy line and arrow migration', () => {
  it('reconstructs endpoints along the old bottom-left to top-right diagonal', () => {
    const out = migrateDoc(doc({ a1: legacyArrow })).objects.a1 as LineShapeObject;
    expect({ x1: out.x1, y1: out.y1, x2: out.x2, y2: out.y2 }).toEqual({
      x1: 0,
      y1: 60, // bottom of the box
      x2: 80, // right of the box
      y2: 0, // top of the box
    });
  });

  it('leaves the bounding box untouched, so nothing moves on screen', () => {
    const out = migrateDoc(doc({ a1: legacyArrow })).objects.a1;
    expect(out).toMatchObject({ x: 100, y: 200, width: 80, height: 60 });
  });

  it('preserves stroke styling', () => {
    const out = migrateDoc(doc({ a1: legacyArrow })).objects.a1 as LineShapeObject;
    expect(out).toMatchObject({ stroke: '#ff0000', strokeWidth: 3, strokeOpacity: 0.9 });
  });

  it('preserves the arrow head size', () => {
    const out = migrateDoc(doc({ a1: legacyArrow })).objects.a1 as LineShapeObject;
    expect(out.arrowHeadSize).toBe(12);
  });

  it('gives an arrow a default head size when the old object had none', () => {
    const noHead = { ...(legacyArrow as object), arrowHeadSize: undefined } as unknown as EditorObject;
    const out = migrateDoc(doc({ a1: noHead })).objects.a1 as LineShapeObject;
    expect(out.arrowHeadSize).toBeGreaterThan(0);
  });

  it('migrates plain lines too, without inventing a head', () => {
    const legacyLine = { ...(legacyArrow as object), kind: 'line', arrowHeadSize: undefined } as unknown as EditorObject;
    const out = migrateDoc(doc({ a1: legacyLine })).objects.a1 as LineShapeObject;
    expect(out.kind).toBe('line');
    expect(out.arrowHeadSize).toBeUndefined();
  });

  it('drops the meaningless fill fields a line used to carry', () => {
    const out = migrateDoc(doc({ a1: legacyArrow })).objects.a1 as unknown as Record<string, unknown>;
    expect(out.fill).toBeUndefined();
    expect(out.fillOpacity).toBeUndefined();
  });
});

describe('migration safety', () => {
  it('is idempotent: running it twice changes nothing', () => {
    const once = migrateDoc(doc({ a1: legacyArrow }));
    const twice = migrateDoc(once);
    expect(twice.objects.a1).toEqual(once.objects.a1);
  });

  it('leaves an already-migrated line alone', () => {
    const modern: LineShapeObject = {
      id: 'l1',
      pageId: 'p1',
      kind: 'line',
      x: 10,
      y: 10,
      width: 50,
      height: 0,
      x1: 0,
      y1: 0,
      x2: 50,
      y2: 0,
      stroke: '#000000',
      strokeWidth: 1,
      strokeOpacity: 1,
    };
    expect(migrateDoc(doc({ l1: modern })).objects.l1).toEqual(modern);
  });

  it('leaves text and box shapes untouched', () => {
    const text = {
      id: 't1', pageId: 'p1', kind: 'text', x: 0, y: 0, width: 10, height: 10,
      text: 'hi', fontSize: 12, color: '#000', bold: false, italic: false,
      align: 'left', lineHeight: 1.2,
    } as unknown as EditorObject;
    const rect = {
      id: 'r1', pageId: 'p1', kind: 'rect', x: 0, y: 0, width: 10, height: 10,
      fill: '#fff', fillOpacity: 1, stroke: '#000', strokeWidth: 1, strokeOpacity: 1,
    } as unknown as EditorObject;

    const out = migrateDoc(doc({ t1: text, r1: rect }));
    expect(out.objects.t1).toEqual(text);
    expect(out.objects.r1).toEqual(rect);
  });

  it('keeps pages and file name intact', () => {
    const d = doc({ a1: legacyArrow });
    const out = migrateDoc(d);
    expect(out.pages).toEqual(d.pages);
    expect(out.fileName).toBe('x.pdf');
  });
});
