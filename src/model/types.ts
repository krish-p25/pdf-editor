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

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';

export interface ShapeObject extends BaseObject {
  kind: ShapeKind;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  cornerRadius?: number;
  arrowHeadSize?: number;
}

export type EditorObject = TextObject | ShapeObject;

export const isText = (o: EditorObject): o is TextObject => o.kind === 'text';
export const isShape = (o: EditorObject): o is ShapeObject => o.kind !== 'text';

export type ToolId = 'select' | 'text' | ShapeKind;
