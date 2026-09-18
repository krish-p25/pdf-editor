import type { SnapIndicator } from '../geometry/snapping';

interface Props {
  indicators: SnapIndicator[];
  zoom: number;
}

/**
 * Three visually distinct snap signals.
 *
 * Object snaps outline the object snapped TO, rather than drawing an infinite
 * guide line. A guide line tells you where you aligned; the outline tells you
 * what you aligned with, which is the question the user actually has.
 */
export function SnapIndicators({ indicators, zoom }: Props) {
  return (
    <>
      {indicators.map((ind, i) => {
        if (ind.kind === 'object') {
          return (
            <div
              key={`o${i}`}
              className="pointer-events-none absolute border-2 border-accent"
              style={{
                left: ind.rect.x * zoom,
                top: ind.rect.y * zoom,
                width: ind.rect.width * zoom,
                height: ind.rect.height * zoom,
              }}
            />
          );
        }

        if (ind.kind === 'page') {
          return (
            <div
              key={`p${i}`}
              className="pointer-events-none absolute border-accent"
              style={
                ind.axis === 'x'
                  ? {
                      left: ind.position * zoom,
                      top: 0,
                      height: '100%',
                      borderLeftWidth: 1,
                      borderLeftStyle: 'dashed',
                    }
                  : {
                      left: 0,
                      top: ind.position * zoom,
                      width: '100%',
                      borderTopWidth: 1,
                      borderTopStyle: 'dashed',
                    }
              }
            />
          );
        }

        return (
          <div key={`s${i}`}>
            {ind.gaps.map((g, j) => (
              <div
                key={j}
                className="pointer-events-none absolute bg-accent/20 ring-1 ring-accent"
                style={{
                  left: g.x * zoom,
                  top: g.y * zoom,
                  width: g.width * zoom,
                  height: g.height * zoom,
                }}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
