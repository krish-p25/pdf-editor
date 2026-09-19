export interface Point {
  x: number;
  y: number;
}

/**
 * A line or arrow, stored as a bounding box plus its two endpoints.
 *
 * The endpoints are held RELATIVE to the box origin. That is what lets a line
 * reuse the generic object machinery unchanged: moving, nudging, snapping and
 * multi-select all operate on x/y, and the endpoints travel with the box for
 * free. Only creation and endpoint dragging need to think in absolute points.
 */
export interface LineGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Build a line's geometry from the two points the user dragged between.
 *
 * `start` is where the pointer went down and `end` is where it came up, so an
 * arrow's head belongs at `end`. Unlike a bounding box, this preserves
 * direction: all four diagonals, and exactly horizontal or vertical lines
 * (where the box is degenerate) are all representable.
 */
export function lineFromPoints(start: Point, end: Point): LineGeometry {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    x1: start.x - x,
    y1: start.y - y,
    x2: end.x - x,
    y2: end.y - y,
  };
}

/** Absolute start and end points of a line object. */
export function endpointsOf(o: {
  x: number;
  y: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): { start: Point; end: Point } {
  return {
    start: { x: o.x + o.x1, y: o.y + o.y1 },
    end: { x: o.x + o.x2, y: o.y + o.y2 },
  };
}

/**
 * Snap `end` to the nearest 45-degree increment around `start`.
 *
 * The drag distance is preserved rather than projected onto the constrained
 * axis, so the line is exactly as long as the user dragged. Projecting would
 * shorten it whenever the drag was off-axis, which feels like the tool
 * fighting you.
 */
export function constrainTo45(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: start.x, y: start.y };

  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;

  return {
    x: start.x + Math.cos(angle) * distance,
    y: start.y + Math.sin(angle) * distance,
  };
}

export interface ArrowHead {
  /** The point of the arrow, at the line's end. */
  tip: Point;
  left: Point;
  right: Point;
  /** Where the shaft should stop, at the base of the head. */
  shaftEnd: Point;
}

/** Half-angle of the arrow head, in radians. */
const BARB_SPREAD = Math.PI / 7;

/**
 * Geometry of an arrow head at `end`, pointing away from `start`.
 *
 * The shaft is stopped at the base of the head rather than run to the tip, so
 * a thick stroke does not poke out through the point.
 */
export function arrowHead(start: Point, end: Point, size: number): ArrowHead {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // A zero-length line has no direction; pick one so the maths stays finite.
  const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);

  const back = (offset: number): Point => ({
    x: end.x - Math.cos(angle + offset) * size,
    y: end.y - Math.sin(angle + offset) * size,
  });

  return {
    tip: { x: end.x, y: end.y },
    left: back(-BARB_SPREAD),
    right: back(BARB_SPREAD),
    shaftEnd: back(0),
  };
}

/** Length of a line object, in points. */
export function lineLength(o: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
}
