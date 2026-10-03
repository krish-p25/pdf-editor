import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { bundleImages, exportScale, imageFileNames, MAX_EXPORT_EDGE } from './exportImages';

describe('exportScale', () => {
  it('treats 72 DPI as scale 1, since a PDF point is 1/72 inch', () => {
    expect(exportScale(595, 842, 72)).toBe(1);
  });

  it('scales linearly with DPI', () => {
    expect(exportScale(595, 842, 300)).toBeCloseTo(300 / 72, 10);
  });

  it('caps the longest edge', () => {
    const s = exportScale(595, 842, 300, 1000);
    expect(842 * s).toBeCloseTo(1000, 6);
  });

  it('caps whichever edge is longer, landscape included', () => {
    const s = exportScale(842, 595, 300, 1000);
    expect(842 * s).toBeCloseTo(1000, 6);
  });

  it('leaves an A4 page at 300 DPI uncapped by default', () => {
    expect(exportScale(595, 842, 300)).toBeCloseTo(300 / 72, 10);
    expect(842 * (300 / 72)).toBeLessThan(MAX_EXPORT_EDGE);
  });
});

describe('imageFileNames', () => {
  it('numbers pages from one with at least two digits', () => {
    expect(imageFileNames('Report', 2, 'png')).toEqual(['Report-page-01.png', 'Report-page-02.png']);
  });

  it('pads to the page count when it has more digits', () => {
    const names = imageFileNames('x', 120, 'png');
    expect(names[0]).toBe('x-page-001.png');
    expect(names[119]).toBe('x-page-120.png');
  });

  it('uses .jpg for JPEG', () => {
    expect(imageFileNames('Report', 2, 'jpeg')[0]).toBe('Report-page-01.jpg');
  });

  it('sorts in page order as plain strings', () => {
    // The point of the padding: file managers sort names as text.
    const names = imageFileNames('x', 12, 'png');
    expect([...names].sort()).toEqual(names);
  });
});

describe('bundleImages', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5, 6, 7]);

  it('returns a single page as the image itself, named after the document', () => {
    const out = bundleImages('Report', [a], 'png');
    expect(out.fileName).toBe('Report.png');
    expect(out.mime).toBe('image/png');
    expect(out.bytes).toBe(a);
  });

  it('labels a single JPEG correctly', () => {
    const out = bundleImages('Report', [a], 'jpeg');
    expect(out.fileName).toBe('Report.jpg');
    expect(out.mime).toBe('image/jpeg');
  });

  it('zips several pages, one entry per page, in order', () => {
    const out = bundleImages('Report', [a, b], 'jpeg');
    expect(out.fileName).toBe('Report-pages.zip');
    expect(out.mime).toBe('application/zip');

    const files = unzipSync(out.bytes);
    expect(Object.keys(files)).toEqual(['Report-page-01.jpg', 'Report-page-02.jpg']);
    expect(Array.from(files['Report-page-01.jpg'])).toEqual(Array.from(a));
    expect(Array.from(files['Report-page-02.jpg'])).toEqual(Array.from(b));
  });

  it('refuses to bundle nothing', () => {
    expect(() => bundleImages('Report', [], 'png')).toThrow();
  });
});
