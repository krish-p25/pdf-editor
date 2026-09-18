import type { ShapeObject } from '../model/types';

interface Props {
  o: ShapeObject;
  zoom: number;
}

/**
 * Shapes render as inline SVG so the browser draws the same primitives the
 * exporter draws, in the same coordinate space scaled by zoom.
 */
export function ShapeObjectView({ o, zoom }: Props) {
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

      {o.kind === 'line' && (
        <line
          x1={0}
          y1={h}
          x2={w}
          y2={0}
          stroke={o.stroke}
          strokeWidth={sw}
          strokeOpacity={o.strokeOpacity}
        />
      )}

      {o.kind === 'arrow' && <Arrow o={o} w={w} h={h} sw={sw} zoom={zoom} />}
    </svg>
  );
}

function Arrow({
  o,
  w,
  h,
  sw,
  zoom,
}: {
  o: ShapeObject;
  w: number;
  h: number;
  sw: number;
  zoom: number;
}) {
  const head = (o.arrowHeadSize ?? Math.max(6, o.strokeWidth * 3)) * zoom;

  // Drawn bottom-left to top-right across the box, matching the exporter.
  const sx = 0;
  const sy = h;
  const ex = w;
  const ey = 0;
  const angle = Math.atan2(ey - sy, ex - sx);

  // Stop the shaft at the base of the head so a thick stroke does not poke
  // through the tip.
  const bx = ex - Math.cos(angle) * head;
  const by = ey - Math.sin(angle) * head;

  const spread = Math.PI / 7;
  const p1x = ex - Math.cos(angle - spread) * head;
  const p1y = ey - Math.sin(angle - spread) * head;
  const p2x = ex - Math.cos(angle + spread) * head;
  const p2y = ey - Math.sin(angle + spread) * head;

  return (
    <>
      <line
        x1={sx}
        y1={sy}
        x2={bx}
        y2={by}
        stroke={o.stroke}
        strokeWidth={sw}
        strokeOpacity={o.strokeOpacity}
      />
      <polygon
        points={`${ex},${ey} ${p1x},${p1y} ${p2x},${p2y}`}
        fill={o.stroke}
        fillOpacity={o.strokeOpacity}
      />
    </>
  );
}
