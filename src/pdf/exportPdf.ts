import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layoutText, lineX, variantOf, type FontMetrics, type FontVariant } from './fontMetrics';
import { rectToPdf } from '../geometry/coords';
import { isText, type Doc, type ShapeObject, type TextObject } from '../model/types';

export type FontSet = Record<FontVariant, FontMetrics>;

/** Convert "#rgb" or "#rrggbb" to a pdf-lib RGB. */
export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return rgb(0, 0, 0);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawTextObject(
  page: PDFPage,
  o: TextObject,
  metrics: FontMetrics,
  font: PDFFont,
  pageHeight: number,
): void {
  const layout = layoutText(metrics, o.text, o.fontSize, o.width, o.lineHeight);
  const color = hexToRgb(o.color);

  layout.lines.forEach((line, i) => {
    if (line.text === '') return;
    const xOffset = lineX(layout, i, o.align, o.width);
    // Baseline measured from the top of the text box, then flipped into PDF
    // user space where y grows upward. Identical arithmetic to the DOM view.
    const baselineFromTop = i * layout.lineBoxHeight + layout.baselineOffset;
    page.drawText(line.text, {
      x: o.x + xOffset,
      y: pageHeight - (o.y + baselineFromTop),
      size: o.fontSize,
      font,
      color,
    });
  });
}

function drawShapeObject(page: PDFPage, o: ShapeObject, pageHeight: number): void {
  const r = rectToPdf(o, pageHeight);
  const fill = hexToRgb(o.fill);
  const stroke = hexToRgb(o.stroke);
  const hasFill = o.fill !== 'none';

  const common = {
    color: hasFill ? fill : undefined,
    opacity: hasFill ? o.fillOpacity : 0,
    borderColor: stroke,
    borderWidth: o.strokeWidth,
    borderOpacity: o.strokeOpacity,
  };

  switch (o.kind) {
    case 'rect':
      page.drawRectangle({
        ...common,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
      return;

    case 'ellipse':
      page.drawEllipse({
        ...common,
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        xScale: r.width / 2,
        yScale: r.height / 2,
      });
      return;

    case 'triangle': {
      // drawSvgPath uses a y-down coordinate system anchored at the given
      // x/y, so the path is written relative to the box's TOP-left corner.
      const d = `M ${o.width / 2} 0 L ${o.width} ${o.height} L 0 ${o.height} Z`;
      page.drawSvgPath(d, {
        x: r.x,
        y: r.y + r.height,
        color: hasFill ? fill : undefined,
        opacity: hasFill ? o.fillOpacity : 0,
        borderColor: stroke,
        borderWidth: o.strokeWidth,
        borderOpacity: o.strokeOpacity,
      });
      return;
    }

    case 'line':
      // Drawn along the box diagonal, bottom-left to top-right, matching the
      // SVG preview.
      page.drawLine({
        start: { x: r.x, y: r.y },
        end: { x: r.x + r.width, y: r.y + r.height },
        color: stroke,
        thickness: o.strokeWidth,
        opacity: o.strokeOpacity,
      });
      return;

    case 'arrow': {
      const head = o.arrowHeadSize ?? Math.max(6, o.strokeWidth * 3);
      const sx = r.x;
      const sy = r.y;
      const ex = r.x + r.width;
      const ey = r.y + r.height;
      const angle = Math.atan2(ey - sy, ex - sx);

      // Stop the shaft at the base of the head so a thick stroke does not
      // poke through the tip.
      const bx = ex - Math.cos(angle) * head;
      const by = ey - Math.sin(angle) * head;

      page.drawLine({
        start: { x: sx, y: sy },
        end: { x: bx, y: by },
        color: stroke,
        thickness: o.strokeWidth,
        opacity: o.strokeOpacity,
      });

      const spread = Math.PI / 7;
      const p1x = ex - Math.cos(angle - spread) * head;
      const p1y = ey - Math.sin(angle - spread) * head;
      const p2x = ex - Math.cos(angle + spread) * head;
      const p2y = ey - Math.sin(angle + spread) * head;

      // drawSvgPath is y-down, so negate y and anchor at the origin.
      const d = `M ${ex} ${-ey} L ${p1x} ${-p1y} L ${p2x} ${-p2y} Z`;
      page.drawSvgPath(d, {
        x: 0,
        y: 0,
        color: stroke,
        opacity: o.strokeOpacity,
        borderWidth: 0,
      });
      return;
    }
  }
}

/**
 * Build the exported PDF: copy the surviving source pages in the user's order,
 * apply rotation, then draw each page's objects back-to-front.
 *
 * Objects are stored in unrotated page space, so drawing needs no rotation
 * handling at all — the viewer applies /Rotate to the finished page.
 */
export async function exportPdf(doc: Doc, fonts: FontSet): Promise<Uint8Array> {
  const source = await PDFDocument.load(doc.sourceBytes);
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);

  // Embed only the variants actually used, and only once each.
  const used = new Set<FontVariant>();
  for (const o of Object.values(doc.objects)) {
    if (isText(o)) used.add(variantOf(o.bold, o.italic));
  }

  const embedded = {} as Record<FontVariant, PDFFont>;
  for (const v of used) {
    embedded[v] = await out.embedFont(fonts[v].bytes, { subset: true });
  }

  const copied = await out.copyPages(
    source,
    doc.pages.map((p) => p.sourceIndex),
  );

  for (let i = 0; i < doc.pages.length; i++) {
    const modelPage = doc.pages[i];
    const pdfPage = out.addPage(copied[i]);

    if (modelPage.rotation !== 0) {
      const base = pdfPage.getRotation().angle;
      pdfPage.setRotation(degrees((base + modelPage.rotation) % 360));
    }

    for (const id of modelPage.objectIds) {
      const o = doc.objects[id];
      if (!o) continue;
      if (isText(o)) {
        const variant = variantOf(o.bold, o.italic);
        const font = embedded[variant];
        if (font) drawTextObject(pdfPage, o, fonts[variant], font, modelPage.height);
      } else {
        drawShapeObject(pdfPage, o, modelPage.height);
      }
    }
  }

  return out.save();
}
