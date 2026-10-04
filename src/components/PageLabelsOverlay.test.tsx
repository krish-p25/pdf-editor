import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMetrics, type FontMetrics } from '../pdf/fontMetrics';
import { labelAnchor, measureLabel } from '../model/pageLabels';
import { placeLabels } from './PageLabelsOverlay';
import type { PageLabel, Rotation } from '../model/types';

let font: FontMetrics;
beforeAll(() => {
  font = createMetrics(new Uint8Array(readFileSync('public/fonts/Inter-Regular.ttf')));
});

const label = (over: Partial<PageLabel> = {}): PageLabel => ({
  id: 'l1',
  text: 'Page {page} of {pages}',
  position: 'bottom',
  align: 'left',
  fontSize: 10,
  color: '#333333',
  margin: 24,
  ...over,
});
const page = (rotation: Rotation = 0) => ({ width: 600, height: 800, rotation });

describe('placeLabels', () => {
  it('fills in the page number', () => {
    expect(placeLabels([label()], page(), 2, 5, font, 1)[0].text).toBe('Page 3 of 5');
  });

  it('places the label where labelAnchor says, scaled by the zoom', () => {
    const [p] = placeLabels([label()], page(), 0, 1, font, 2);
    const m = measureLabel(font, 'Page 1 of 1', 10);
    const at = labelAnchor(label(), { width: 600, height: 800 }, m);

    expect(p.left).toBeCloseTo(at.x * 2, 6);
    expect(p.top).toBeCloseTo((at.y - m.ascent) * 2, 6);
    expect(p.fontSize).toBe(20);
    expect(p.lineHeight).toBeCloseTo((m.ascent - m.descent) * 2, 6);
  });

  it('lays out against the page as it is shown when rotated', () => {
    // A 600x800 page turned 90 degrees is shown 800 wide.
    const [p] = placeLabels([label({ align: 'right' })], page(90), 0, 1, font, 1);
    const m = measureLabel(font, 'Page 1 of 1', 10);
    expect(p.left).toBeCloseTo(800 - 24 - m.width, 6);
  });

  it('omits a label whose text is blank', () => {
    expect(placeLabels([label({ text: '   ' })], page(), 0, 1, font, 1)).toEqual([]);
  });

  it('keeps one entry per label, in order', () => {
    const got = placeLabels(
      [label({ id: 'a' }), label({ id: 'b', position: 'top' })],
      page(),
      0,
      1,
      font,
      1,
    );
    expect(got.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
