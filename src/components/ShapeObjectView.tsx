import { arrowHead } from '../geometry/lines';
import { isLine, type BoxShapeObject, type LineShapeObject, type ShapeObject } from '../model/types';

interface Props {
  o: ShapeObject;
  zoom: number;
}

/**
 * Shapes render as inline SVG so the browser draws the same primitives the
 * exporter draws, in the same coordinate space scaled by zoom.
 */
export function ShapeObjectView({ o, zoom }: Props) {
  return isLine(o) ? <LineView o={o} zoom={zoom} /> : <BoxView o={o} zoom={zoom} />;
}

function BoxView({ o, zoom }: { o: BoxShapeObject; zoom: number }) {
  const w = o.width * zoom;
  const h = o.height * zoom;
  const sw = o.strokeWidth * zoom;
  const hasFill = o.fill !== 'none';

  const paint = {
    fill: hasFill ? o.fill : 'none',
    fillOpacity: hasFill ? o.fillOpacity : 0,
    stroke: o.stroke,
    strokeWidth: sw,
    strokeOpacity: o.strokeOpacity,
  };

  // Inset by half the stroke so the outline is not clipped at the viewport edge.
  const i = sw / 2;

  return (
    <svg width={w} height={h} className="pointer-events-none block overflow-visible">
      {o.kind === 'rect' && (
        <rect
          x={i}
          y={i}
          width={Math.max(0, w - sw)}
          height={Math.max(0, h - sw)}
          rx={(o.cornerRadius ?? 0) * zoom}
          {...paint}
        />
      )}

      {o.kind === 'ellipse' && (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0, w / 2 - i)}
          ry={Math.max(0, h / 2 - i)}
          {...paint}
        />
      )}

      {o.kind === 'triangle' && (
        <polygon points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`} {...paint} />
      )}
    </svg>
  );
}

/**
 * A line or arrow, drawn between its two stored endpoints.
 *
 * The SVG viewport is the object's bounding box, which for a horizontal or
 * vertical line has zero height or width. overflow-visible keeps the stroke
 * and arrow head drawable outside that degenerate box.
 */
function LineView({ o, zoom }: { o: LineShapeObject; zoom: number }) {
  const sw = o.strokeWidth * zoom;
  const start = { x: o.x1 * zoom, y: o.y1 * zoom };
  const end = { x: o.x2 * zoom, y: o.y2 * zoom };

  const isArrow = o.kind === 'arrow';
  const head = isArrow
    ? arrowHead(start, end, (o.arrowHeadSize ?? Math.max(6, o.strokeWidth * 3)) * zoom)
    : null;
  const shaftEnd = head ? head.shaftEnd : end;

  return (
    <svg
      width={Math.max(o.width * zoom, 1)}
      height={Math.max(o.height * zoom, 1)}
      className="pointer-events-none block overflow-visible"
    >
      <line
        x1={start.x}
        y1={start.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke={o.stroke}
        strokeWidth={sw}
        strokeOpacity={o.strokeOpacity}
        strokeLinecap="round"
      />
      {head && (
        <polygon
          points={`${head.tip.x},${head.tip.y} ${head.left.x},${head.left.y} ${head.right.x},${head.right.y}`}
          fill={o.stroke}
          fillOpacity={o.strokeOpacity}
        />
      )}
    </svg>
  );
}
