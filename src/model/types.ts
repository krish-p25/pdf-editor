export type ObjectId = string;
export type PageId = string;
export type Rotation = 0 | 90 | 180 | 270;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A page of the working document. Coordinates of its objects are in UNROTATED
 * page space: origin top-left, y-down, units = PDF points. Rotation is applied
 * as a view transform only, so nothing downstream needs to know about it.
 */
export interface Page {
  id: PageId;
  sourceIndex: number;
  /** User-applied rotation, added to the source page's own /Rotate at export. */
  rotation: Rotation;
  width: number;
  height: number;
  /** Array order is z-order; the last element renders in front. */
  objectIds: ObjectId[];
}

export interface BaseObject extends Rect {
  id: ObjectId;
  pageId: PageId;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextObject extends BaseObject {
  kind: 'text';
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** Multiplier applied to fontSize to get the line box height. */
  lineHeight: number;
}

export type BoxShapeKind = 'rect' | 'ellipse' | 'triangle';
export type LineShapeKind = 'line' | 'arrow';
export type ShapeKind = BoxShapeKind | LineShapeKind;

/** A shape whose form is defined by its bounding box. */
export interface BoxShapeObject extends BaseObject {
  kind: BoxShapeKind;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  cornerRadius?: number;
}

/**
 * A line or arrow, defined by two points rather than a box.
 *
 * x1/y1 and x2/y2 are RELATIVE to the object's x/y. Keeping them relative
 * means moving, nudging and snapping only touch x/y, and the endpoints follow
 * automatically. x/y/width/height remain the derived bounding box, so
 * selection, z-order and snapping work unchanged.
 *
 * Modelling these as a box would lose direction (a box has two diagonals) and
 * could not represent a horizontal or vertical line at all.
 */
export interface LineShapeObject extends BaseObject {
  kind: LineShapeKind;
  /** Start of the line, where the drag began. */
  x1: number;
  y1: number;
  /** End of the line. An arrow's head sits here. */
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  arrowHeadSize?: number;
}

export type ShapeObject = BoxShapeObject | LineShapeObject;

export type EditorObject = TextObject | ShapeObject;

/** The whole working document. `sourceBytes` is never mutated. */
export interface Doc {
  fileName: string;
  sourceBytes: Uint8Array;
  /** Array order IS the export order. */
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
}

export const isText = (o: EditorObject): o is TextObject => o.kind === 'text';
export const isShape = (o: EditorObject): o is ShapeObject => o.kind !== 'text';

export const isLine = (o: EditorObject): o is LineShapeObject =>
  o.kind === 'line' || o.kind === 'arrow';

export const isBoxShape = (o: EditorObject): o is BoxShapeObject =>
  o.kind === 'rect' || o.kind === 'ellipse' || o.kind === 'triangle';

export type ToolId = 'select' | 'text' | ShapeKind;
