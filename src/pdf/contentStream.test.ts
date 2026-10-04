import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { drawnTextOnPage } from './contentStream';

/** A one-page PDF with an 'x' drawn at (100, 200) at each of the given angles. */
async function drawnAt(angles: number[]) {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 800]);
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (const a of angles) p.drawText('x', { x: 100, y: 200, size: 12, font, rotate: degrees(a) });
  return drawnTextOnPage(await d.save(), 0);
}

describe('drawnTextOnPage', () => {
  it('reads upright text as angle 0', async () => {
    const [t] = await drawnAt([0]);
    expect(t).toMatchObject({ x: 100, y: 200, size: 12, angle: 0 });
  });

  it('finds text rotated by every quarter turn', async () => {
    expect((await drawnAt([0, 90, 180, 270])).map((t) => t.angle)).toEqual([0, 90, 180, 270]);
  });

  it('still reports where rotated text is anchored', async () => {
    const drawn = await drawnAt([90, 180, 270]);
    // Without this, a helper that finds no rotated text passes the loop below
    // by never entering it.
    expect(drawn).toHaveLength(3);
    for (const t of drawn) {
      expect(t.x).toBe(100);
      expect(t.y).toBe(200);
    }
  });
});
