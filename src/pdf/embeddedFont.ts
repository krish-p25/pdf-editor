import { PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { inflateSync } from 'node:zlib';

export interface EmbeddedFontReport {
  numGlyphs: number;
  /** Glyph ids that carry no drawable outline. */
  emptyGlyphs: number[];
}

interface ParsedFont {
  numGlyphs: number;
  getGlyph(id: number): { path?: { commands: unknown[] } };
}

/**
 * Pull every embedded TrueType font out of a PDF and report which of its
 * glyphs have no outline.
 *
 * Test-only: it relies on node:zlib and is never imported by application code.
 *
 * This exists because a font can be embedded with perfectly correct text
 * operators, coordinates and widths while its `glyf` outlines are corrupt. The
 * result is text that occupies exactly the right space with individual letters
 * simply missing — invisible to any test that only checks positions.
 */
export async function embeddedFontReports(bytes: Uint8Array): Promise<EmbeddedFontReport[]> {
  const doc = await PDFDocument.load(bytes);
  const reports: EmbeddedFontReport[] = [];

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const ref = obj.get(PDFName.of('FontFile2'));
    if (!ref) continue;

    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;

    let raw = Buffer.from(stream.contents);
    try {
      raw = inflateSync(raw);
    } catch {
      /* already uncompressed */
    }

    const font = fontkit.create(raw as never) as unknown as ParsedFont;
    const emptyGlyphs: number[] = [];

    // Glyph 0 is .notdef and is allowed to be blank.
    for (let gid = 1; gid < font.numGlyphs; gid++) {
      try {
        const path = font.getGlyph(gid).path;
        if (!path || path.commands.length === 0) emptyGlyphs.push(gid);
      } catch {
        emptyGlyphs.push(gid);
      }
    }

    reports.push({ numGlyphs: font.numGlyphs, emptyGlyphs });
  }

  return reports;
}
