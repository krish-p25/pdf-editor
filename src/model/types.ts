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
  /**
   * Index of this page in the uploaded PDF, or null for a blank page added in
   * the editor. A blank page has no source to copy from, so it is created at
   * its stored size on export rather than copied.
   */
  sourceIndex: number | null;
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

/**
 * Styling that may be overridden for part of a text box. Every key is
 * optional: an absent key means "inherit the box's own value".
 */
export interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fontSize?: number;
}

/**
 * A styling override applied to the characters in `[start, end)` of a text
 * object's `text`.
 *
 * Styling is modelled as sparse overrides on top of the object's own
 * bold/italic/color/fontSize rather than as a list of styled runs, because
 * that keeps `text` the single authoritative string. The textarea, the
 * placeholder logic and the empty-box check all read it directly, and a
 * document saved before this existed simply has no spans — which is exactly
 * the old uniform behaviour, so nothing on disk needs migrating.
 */
export interface StyleSpan extends SpanStyle {
  /** Inclusive character offset. */
  start: number;
  /** Exclusive character offset. */
  end: number;
}

export interface TextObject extends BaseObject {
  kind: 'text';
  text: string;
  /** Default size for any character no span overrides. */
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** Multiplier applied to fontSize to get the line box height. */
  lineHeight: number;
  /**
   * Per-range style overrides, normalised: sorted, non-overlapping, non-empty
   * and clipped to the text. Absent or empty means the whole box is uniform.
   */
  spans?: StyleSpan[];
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

/**
 * A crop expressed in normalised source coordinates, 0..1.
 *
 * Normalised rather than pixels so it stays meaningful regardless of the
 * source image's resolution.
 */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageObject extends BaseObject {
  kind: 'image';
  /** The source image as a data URL, e.g. "data:image/png;base64,...". */
  src: string;
  /** Natural pixel dimensions of the source, before any crop. */
  naturalWidth: number;
  naturalHeight: number;
  /** Visible region of the source. */
  crop: Crop;
  /** Clockwise degrees, matching CSS. PDF's anticlockwise sign is applied at export. */
  rotation: number;
  opacity: number;
}

export type EditorObject = TextObject | ShapeObject | ImageObject;

/** The whole working document. `sourceBytes` is never mutated. */
export interface Doc {
  /** Storage key. Generated per upload, so the same file can be opened twice. */
  id: string;
  /**
   * The user-facing name. Editable, shown in the document list, used for the
   * exported filename and written into the PDF's /Title metadata.
   */
  title: string;
  /** Name of the file originally uploaded. Kept as provenance, never edited. */
  fileName: string;
  sourceBytes: Uint8Array;
  /** Array order IS the export order. */
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
}

/** A page added in the editor rather than copied from the uploaded PDF. */
export const isBlankPage = (p: Page): boolean => p.sourceIndex === null;

export const isText = (o: EditorObject): o is TextObject => o.kind === 'text';
export const isImage = (o: EditorObject): o is ImageObject => o.kind === 'image';
export const isShape = (o: EditorObject): o is ShapeObject =>
  o.kind !== 'text' && o.kind !== 'image';

export const isLine = (o: EditorObject): o is LineShapeObject =>
  o.kind === 'line' || o.kind === 'arrow';

export const isBoxShape = (o: EditorObject): o is BoxShapeObject =>
  o.kind === 'rect' || o.kind === 'ellipse' || o.kind === 'triangle';

export type ToolId = 'select' | 'text' | 'image' | ShapeKind;
