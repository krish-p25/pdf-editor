import { useEffect, useState } from 'react';
import { displaySize, type PageGeometry } from '../geometry/coords';
import { formatLabel, labelAnchor, measureLabel } from '../model/pageLabels';
import { getLoadedFont, primeFont, type FontMetrics } from '../pdf/fontMetrics';
import type { PageLabel } from '../model/types';

/** A label resolved for one page, in CSS pixels at the given zoom. */
export interface PlacedLabel {
  id: string;
  text: string;
  left: number;
  top: number;
  fontSize: number;
  lineHeight: number;
  color: string;
}

/**
 * Resolve every label for one page.
 *
 * Uses the same formatLabel, measureLabel and labelAnchor as the exporter, so
 * the preview and the download cannot disagree about where a label goes.
 */
export function placeLabels(
  labels: readonly PageLabel[],
  page: PageGeometry,
  index: number,
  count: number,
  font: FontMetrics,
  zoom: number,
): PlacedLabel[] {
  const display = displaySize(page);
  const out: PlacedLabel[] = [];

  for (const label of labels) {
    const text = formatLabel(label.text, index, count);
    if (text.trim() === '') continue;

    const m = measureLabel(font, text, label.fontSize);
    const at = labelAnchor(label, display, m);
    out.push({
      id: label.id,
      text,
      left: at.x * zoom,
      top: (at.y - m.ascent) * zoom,
      fontSize: label.fontSize * zoom,
      lineHeight: (m.ascent - m.descent) * zoom,
      color: label.color,
    });
  }

  return out;
}

interface Props {
  page: PageGeometry;
  /** Position in the document, from zero. */
  index: number;
  count: number;
  labels: readonly PageLabel[];
  zoom: number;
}

/**
 * Headers, footers and page numbers drawn over a page.
 *
 * Must be placed in the page's DISPLAY-space box, outside the rotated inner
 * box: that is what keeps labels upright on a rotated page.
 */
export function PageLabelsOverlay({ page, index, count, labels, zoom }: Props) {
  const [, setFontArrived] = useState(0);
  const font = getLoadedFont('regular');

  // Regular is primed when a document opens, but a thumbnail can mount before
  // it lands; render again once it does.
  useEffect(() => {
    if (font) return;
    let live = true;
    primeFont('regular')
      .then(() => {
        if (live) setFontArrived((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [font]);

  if (!font || labels.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {placeLabels(labels, page, index, count, font, zoom).map((p) => (
        <span
          key={p.id}
          className="pdf-text absolute"
          style={{
            left: p.left,
            top: p.top,
            fontSize: p.fontSize,
            lineHeight: `${p.lineHeight}px`,
            color: p.color,
            fontFamily: 'InterPdf, Inter, sans-serif',
            whiteSpace: 'pre',
          }}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
}
