import { displaySize, displayToPage, type PageGeometry } from '../geometry/coords';
import type { FontMetrics } from '../pdf/fontMetrics';
import type { PageLabel } from './types';

/** Replaced with the page number, counting from one. */
export const PAGE_TOKEN = '{page}';
/** Replaced with the number of pages in the document. */
export const PAGES_TOKEN = '{pages}';

/**
 * Fill in a label's tokens for one page.
 *
 * `index` is the page's position in the document - its export order - not its
 * index in the uploaded PDF, so numbering follows reordering.
 */
export function formatLabel(template: string, index: number, count: number): string {
  return template.replaceAll(PAGE_TOKEN, String(index + 1)).replaceAll(PAGES_TOKEN, String(count));
}

/** What placement needs to know about a piece of label text, in points. */
export interface LabelMetrics {
  width: number;
  /** Above the baseline. Positive. */
  ascent: number;
  /** Below the baseline. Negative, as fonts report it. */
  descent: number;
}

/** Measure label text with the font the export embeds. */
export function measureLabel(font: FontMetrics, text: string, fontSize: number): LabelMetrics {
  return {
    width: font.measureText(text, fontSize),
    ascent: (font.ascent / font.unitsPerEm) * fontSize,
    descent: (font.descent / font.unitsPerEm) * fontSize,
  };
}

type Placement = Pick<PageLabel, 'position' | 'align' | 'margin'>;

/**
 * Where a label's baseline starts, in DISPLAY space: the page as the user sees
 * it, after rotation, origin top-left, y down.
 *
 * Laying out in display space is what keeps a label upright at the visual top
 * or bottom whichever way the page is turned. The margin is measured to the
 * nearest edge of the text, so a top label drops by its ascent and a bottom
 * label rises by its descent.
 */
export function labelAnchor(
  label: Placement,
  display: { width: number; height: number },
  m: LabelMetrics,
): { x: number; y: number } {
  const y =
    label.position === 'top' ? label.margin + m.ascent : display.height - label.margin + m.descent;
  const x =
    label.align === 'left'
      ? label.margin
      : label.align === 'right'
        ? display.width - label.margin - m.width
        : (display.width - m.width) / 2;
  return { x, y };
}

/**
 * Where, and at what angle, to draw a label in PDF user space.
 *
 * The PDF is drawn unrotated and the viewer then applies /Rotate, so the
 * display-space anchor is mapped back through displayToPage and the y axis is
 * flipped. The text is turned by the page rotation: pdf-lib measures that
 * angle anticlockwise, which exactly cancels the viewer's clockwise /Rotate
 * and leaves the label reading upright.
 */
export function labelPdfPlacement(
  label: Placement,
  page: PageGeometry,
  m: LabelMetrics,
): { x: number; y: number; angle: number } {
  const anchor = labelAnchor(label, displaySize(page), m);
  const p = displayToPage(anchor, page);
  return { x: p.x, y: page.height - p.y, angle: page.rotation };
}

const LABEL_DEFAULTS = { fontSize: 10, color: '#333333', margin: 24 } as const;

/** "Page 1 of 12", centred at the bottom. */
export function pageNumberLabel(id: string): PageLabel {
  return {
    id,
    text: `Page ${PAGE_TOKEN} of ${PAGES_TOKEN}`,
    position: 'bottom',
    align: 'center',
    ...LABEL_DEFAULTS,
  };
}

/** A running header, top left. */
export function headerLabel(id: string, text: string): PageLabel {
  return { id, text, position: 'top', align: 'left', ...LABEL_DEFAULTS };
}
