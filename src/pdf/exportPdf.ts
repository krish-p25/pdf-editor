import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage, type RGB } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import {
  layoutStyledText,
  lineX,
  variantOf,
  variantsOf,
  type FontMetrics,
  type FontVariant,
  type MetricsFor,
} from './fontMetrics';
import { defaultStyleOf } from '../model/textSpans';
import { rectToPdf } from '../geometry/coords';
import { arrowHead } from '../geometry/lines';
import { cropPixels, rotatedDrawAnchor, FULL_CROP } from '../geometry/images';
import { dataUrlToBytes, isJpegDataUrl } from './imageFile';
import {
  isImage,
  isLine,
  isText,
  type BoxShapeObject,
  type Doc,
  type ImageObject,
  type LineShapeObject,
  type Page,
  type PageLabel,
  type TextObject,
} from '../model/types';
import { formatLabel, labelPdfPlacement, measureLabel } from '../model/pageLabels';

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

/**
 * Draw a text box one styled run at a time.
 *
 * A run is a stretch of characters sharing a font variant, size and colour,
 * which is the largest unit a single drawText call can express. Runs on a
 * line share one baseline, so mixed sizes sit on the line together rather
 * than each floating in its own box.
 */
function drawTextObject(
  page: PDFPage,
  o: TextObject,
  fonts: FontSet,
  embedded: Record<FontVariant, PDFFont>,
  pageHeight: number,
): void {
  const metrics: MetricsFor = (s) => fonts[variantOf(s.bold, s.italic)];
  const layout = layoutStyledText(
    metrics,
    o.text,
    o.spans,
    defaultStyleOf(o),
    o.width,
    o.lineHeight,
  );

  layout.lines.forEach((line, i) => {
    if (line.text === '') return;
    const xOffset = lineX(layout, i, o.align, o.width);
    // Baseline measured from the top of the text box, then flipped into PDF
    // user space where y grows upward. Identical arithmetic to the DOM view.
    const baselineFromTop = line.top + line.baselineOffset;

    for (const run of line.runs) {
      if (run.text === '') continue;
      const font = embedded[variantOf(run.style.bold, run.style.italic)];
      if (!font) continue;
      page.drawText(run.text, {
        x: o.x + xOffset + run.x,
        y: pageHeight - (o.y + baselineFromTop),
        size: run.style.fontSize,
        font,
        color: hexToRgb(run.style.color),
      });
    }
  });
}

/**
 * Draw a line or arrow between its two stored endpoints.
 *
 * Endpoints are relative to the object's box and measured y-down, so each is
 * flipped into PDF user space individually. Going through the bounding box
 * would lose the direction, which is the whole point of storing endpoints.
 */
function drawLineObject(page: PDFPage, o: LineShapeObject, pageHeight: number): void {
  const stroke = hexToRgb(o.stroke);
  const toPdf = (rx: number, ry: number) => ({
    x: o.x + rx,
    y: pageHeight - (o.y + ry),
  });

  const start = toPdf(o.x1, o.y1);
  const end = toPdf(o.x2, o.y2);

  if (o.kind === 'line') {
    page.drawLine({
      start,
      end,
      color: stroke,
      thickness: o.strokeWidth,
      opacity: o.strokeOpacity,
    });
    return;
  }

  const head = arrowHead(start, end, o.arrowHeadSize ?? Math.max(6, o.strokeWidth * 3));

  page.drawLine({
    start,
    end: head.shaftEnd,
    color: stroke,
    thickness: o.strokeWidth,
    opacity: o.strokeOpacity,
  });

  // drawSvgPath uses a y-down space anchored at x/y, so negate y and anchor
  // at the origin to draw in absolute user-space coordinates.
  const d =
    `M ${head.tip.x} ${-head.tip.y} ` +
    `L ${head.left.x} ${-head.left.y} ` +
    `L ${head.right.x} ${-head.right.y} Z`;
  page.drawSvgPath(d, {
    x: 0,
    y: 0,
    color: stroke,
    opacity: o.strokeOpacity,
    borderWidth: 0,
  });
}

function drawBoxShape(page: PDFPage, o: BoxShapeObject, pageHeight: number): void {
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

  }
}

/**
 * Render an image's cropped region to a data URL.
 *
 * pdf-lib cannot clip an image, so the crop is baked in here. Going through a
 * canvas means the bytes embedded in the PDF are exactly the pixels the
 * preview showed, rather than relying on two renderers agreeing about a
 * clipping path.
 *
 * An uncropped image is passed through untouched, so the common case keeps its
 * original encoding instead of being re-compressed for no reason.
 */
async function croppedImageBytes(o: ImageObject): Promise<{ bytes: Uint8Array; jpeg: boolean }> {
  const isFullCrop =
    o.crop.x === FULL_CROP.x &&
    o.crop.y === FULL_CROP.y &&
    o.crop.width === FULL_CROP.width &&
    o.crop.height === FULL_CROP.height;

  if (isFullCrop) {
    return { bytes: dataUrlToBytes(o.src), jpeg: isJpegDataUrl(o.src) };
  }

  const region = cropPixels(o.crop, o.naturalWidth, o.naturalHeight);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not decode an image for export.'));
    el.src = o.src;
  });

  const canvas = document.createElement('canvas');
  canvas.width = region.width;
  canvas.height = region.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire a 2D canvas context for image export.');

  const jpeg = isJpegDataUrl(o.src);
  if (jpeg) {
    // JPEG has no alpha; without a backdrop a transparent source goes black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, region.width, region.height);
  }
  ctx.drawImage(
    img,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );

  const url = jpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
  return { bytes: dataUrlToBytes(url), jpeg };
}

/**
 * Draw an image, rotated about its centre.
 *
 * pdf-lib rotates about the anchor it is given, which is the bottom-left
 * corner, so the anchor is walked back along the rotated diagonal to put the
 * centre where the user placed it.
 */
async function drawImageObject(
  out: PDFDocument,
  page: PDFPage,
  o: ImageObject,
  pageHeight: number,
): Promise<void> {
  const { bytes, jpeg } = await croppedImageBytes(o);
  const embedded = jpeg ? await out.embedJpg(bytes) : await out.embedPng(bytes);

  const centre = {
    x: o.x + o.width / 2,
    y: pageHeight - (o.y + o.height / 2),
  };
  const anchor = rotatedDrawAnchor(centre, o.width, o.height, o.rotation);

  page.drawImage(embedded, {
    x: anchor.x,
    y: anchor.y,
    width: o.width,
    height: o.height,
    rotate: degrees(anchor.degrees),
    opacity: o.opacity,
  });
}

/**
 * Draw the document's headers, footers and page numbers onto one page.
 *
 * Placement is worked out in display space and mapped back, and the text is
 * turned by the page rotation, so a label reads upright at the visual top or
 * bottom however the page is turned. See labelPdfPlacement.
 */
function drawPageLabels(
  pdfPage: PDFPage,
  modelPage: Page,
  index: number,
  count: number,
  labels: readonly PageLabel[],
  metrics: FontMetrics,
  font: PDFFont,
): void {
  for (const label of labels) {
    const text = formatLabel(label.text, index, count);
    if (text.trim() === '') continue;
    const at = labelPdfPlacement(label, modelPage, measureLabel(metrics, text, label.fontSize));
    pdfPage.drawText(text, {
      x: at.x,
      y: at.y,
      size: label.fontSize,
      font,
      color: hexToRgb(label.color),
      rotate: degrees(at.angle),
    });
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

  // Viewers show /Title in their window title and document properties, so
  // the name the user chose follows the file rather than only the download.
  out.setTitle(doc.title);

  // Embed only the variants actually used, and only once each.
  const used = new Set<FontVariant>();
  for (const o of Object.values(doc.objects)) {
    // A box can need several variants at once now that part of it may be
    // bold or italic on its own.
    if (isText(o)) for (const v of variantsOf(o, o.spans)) used.add(v);
  }

  const labels = doc.pageLabels ?? [];
  // Labels are set in Inter Regular, whatever the text boxes use.
  if (labels.length > 0) used.add('regular');

  const embedded = {} as Record<FontVariant, PDFFont>;
  for (const v of used) {
    embedded[v] = await out.embedFont(fonts[v].bytes, { subset: true });
  }

  // Only pages that came from the upload are copied, so the copied array no
  // longer lines up index-for-index with doc.pages and needs its own cursor.
  const copied = await out.copyPages(
    source,
    doc.pages.map((p) => p.sourceIndex).filter((i): i is number => i !== null),
  );
  let nextCopied = 0;

  for (let i = 0; i < doc.pages.length; i++) {
    const modelPage = doc.pages[i];
    // A blank page has no source to copy; it is created at its stored size.
    const pdfPage =
      modelPage.sourceIndex === null
        ? out.addPage([modelPage.width, modelPage.height])
        : out.addPage(copied[nextCopied++]);

    if (modelPage.rotation !== 0) {
      const base = pdfPage.getRotation().angle;
      pdfPage.setRotation(degrees((base + modelPage.rotation) % 360));
    }

    for (const id of modelPage.objectIds) {
      const o = doc.objects[id];
      if (!o) continue;
      if (isText(o)) {
        drawTextObject(pdfPage, o, fonts, embedded, modelPage.height);
      } else if (isImage(o)) {
        await drawImageObject(out, pdfPage, o, modelPage.height);
      } else if (isLine(o)) {
        drawLineObject(pdfPage, o, modelPage.height);
      } else {
        drawBoxShape(pdfPage, o, modelPage.height);
      }
    }

    // After the objects, so a label is never hidden underneath one.
    if (labels.length > 0) {
      drawPageLabels(pdfPage, modelPage, i, doc.pages.length, labels, fonts.regular, embedded.regular);
    }
  }

  return out.save();
}
