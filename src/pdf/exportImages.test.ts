import { describe, it, expect, vi, afterEach } from 'vitest';
import { unzipSync } from 'fflate';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  bundleImages,
  exportScale,
  imageFileNames,
  MAX_EXPORT_EDGE,
  rasterisePdf,
} from './exportImages';

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

describe('rasterisePdf', () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * A stand-in for pdf.js: jsdom has no canvas and no pdf.js worker, so the
   * real renderer cannot run here. This records how each page is rendered.
   */
  function fakeProxy(numPages: number) {
    const renders: { intent?: string; viewport: { width: number; height: number } }[] = [];
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
      render: (params: (typeof renders)[number]) => {
        renders.push(params);
        return { promise: Promise.resolve() };
      },
      cleanup: () => undefined,
    };
    const proxy = { numPages, getPage: async () => page } as unknown as PDFDocumentProxy;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: () => undefined,
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
      done({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob),
    );

    return { proxy, renders };
  }

  it('renders with print intent, which a background tab cannot pause', async () => {
    // Display intent is paced by requestAnimationFrame, which browsers stop in
    // a hidden tab; an export would stall until the user switched back.
    const { proxy, renders } = fakeProxy(2);
    await rasterisePdf(proxy, 'png', 150);
    expect(renders.map((r) => r.intent)).toEqual(['print', 'print']);
  });

  it('renders every page at the requested DPI', async () => {
    const { proxy, renders } = fakeProxy(3);
    const out = await rasterisePdf(proxy, 'png', 144);
    expect(out).toHaveLength(3);
    // 144 DPI is scale 2 against the 100x200 page.
    expect(renders[0].viewport).toEqual({ width: 200, height: 400 });
  });
});
