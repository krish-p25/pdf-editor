import { useEffect, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '../pdf/renderPage';
import { displaySize } from '../geometry/coords';
import type { Page } from '../model/types';

interface Props {
  proxy: PDFDocumentProxy;
  page: Page;
  zoom: number;
  children?: ReactNode;
}

/**
 * Renders one page.
 *
 * Rotation is applied as a single CSS transform around the whole container, so
 * everything inside — including the object layer — works purely in unrotated
 * page coordinates and needs no rotation awareness of its own.
 */
export function PageCanvas({ proxy, page, zoom, children }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Pass the CSS scale the page is displayed at; renderPage multiplies by the
  // device pixel ratio itself so the raster matches physical pixels exactly.
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    renderPage(proxy, page.sourceIndex, zoom)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [proxy, page.sourceIndex, zoom]);

  const display = displaySize(page);
  const innerW = page.width * zoom;
  const innerH = page.height * zoom;

  return (
    <div
      // The object layer measures pointer coordinates against this element,
      // which is unrotated and sized in DISPLAY space, then converts through
      // displayToPage(). Measuring against the rotated inner div instead would
      // send drags in the wrong direction on rotated pages.
      data-page-root=""
      // shrink-0 is load-bearing: as a flex item this would otherwise be
      // squeezed below its width when the viewport is narrow, squashing the
      // page horizontally while its height stayed put.
      className="relative shrink-0 shadow-lg ring-1 ring-black/10"
      style={{ width: display.width * zoom, height: display.height * zoom }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left bg-white"
        style={{
          width: innerW,
          height: innerH,
          transform: rotationTransform(page.rotation, innerW, innerH),
        }}
      >
        {failed ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600">
            This page could not be rendered.
          </div>
        ) : (
          src && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none h-full w-full select-none"
            />
          )
        )}
        {children}
      </div>
    </div>
  );
}

/** Rotate about the top-left, then translate so the result sits flush. */
function rotationTransform(rotation: number, w: number, h: number): string {
  switch (rotation) {
    case 90:
      return `translate(${h}px, 0) rotate(90deg)`;
    case 180:
      return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270:
      return `translate(0, ${w}px) rotate(270deg)`;
    default:
      return 'none';
  }
}
