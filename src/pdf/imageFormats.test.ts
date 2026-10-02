import { describe, it, expect } from 'vitest';
import { extractTiffPreview, sniffImageFormat } from './imageFormats';

const bytes = (...v: number[]) => new Uint8Array(v);
const str = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
const pad = (b: number[], to = 32) => new Uint8Array([...b, ...new Array(Math.max(0, to - b.length)).fill(0)]);

/** A tiny but structurally valid JPEG: SOI, a comment, EOI. */
const jpeg = (size = 16) => {
  const body = new Array(Math.max(0, size - 4)).fill(0x41);
  return [0xff, 0xd8, ...body, 0xff, 0xd9];
};

describe('sniffImageFormat', () => {
  it('recognises PNG', () => {
    expect(sniffImageFormat(pad([0x89, ...str('PNG'), 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
  });

  it('recognises JPEG', () => {
    expect(sniffImageFormat(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
  });

  it('recognises GIF and BMP', () => {
    expect(sniffImageFormat(pad(str('GIF89a')))).toBe('gif');
    expect(sniffImageFormat(pad(str('BM')))).toBe('bmp');
  });

  it('recognises WebP, which needs both the RIFF and WEBP markers', () => {
    expect(sniffImageFormat(pad([...str('RIFF'), 0, 0, 0, 0, ...str('WEBP')]))).toBe('webp');
    expect(sniffImageFormat(pad([...str('RIFF'), 0, 0, 0, 0, ...str('AVI ')]))).not.toBe('webp');
  });

  it('recognises HEIC by its ftyp brand', () => {
    expect(sniffImageFormat(pad([0, 0, 0, 0x18, ...str('ftyp'), ...str('heic')]))).toBe('heic');
  });

  it('recognises the generic HEIF brands Apple also emits', () => {
    // A HEIC does not have to literally say "heic".
    for (const brand of ['mif1', 'msf1', 'heix', 'hevc']) {
      expect(sniffImageFormat(pad([0, 0, 0, 0x18, ...str('ftyp'), ...str(brand)]))).toBe('heic');
    }
  });

  it('does not mistake other ISO-BMFF files for HEIC', () => {
    expect(sniffImageFormat(pad([0, 0, 0, 0x18, ...str('ftyp'), ...str('mp42')]))).toBe('unknown');
  });

  it('recognises TIFF and DNG in both byte orders', () => {
    expect(sniffImageFormat(pad([...str('II'), 42, 0, 8, 0, 0, 0]))).toBe('tiff');
    expect(sniffImageFormat(pad([...str('MM'), 0, 42, 0, 0, 0, 8]))).toBe('tiff');
  });

  it('rejects a TIFF-like header with the wrong magic number', () => {
    expect(sniffImageFormat(pad([...str('II'), 43, 0, 8, 0, 0, 0]))).toBe('unknown');
  });

  it('returns unknown for junk and for truncated input', () => {
    expect(sniffImageFormat(pad([1, 2, 3, 4]))).toBe('unknown');
    expect(sniffImageFormat(bytes(1, 2))).toBe('unknown');
  });
});

/**
 * Build a little-endian TIFF whose single IFD describes a JPEG-compressed
 * strip — the shape a DNG preview takes.
 */
function dngWithPreview(previewBytes: number[], opts: { reduced?: boolean } = {}): Uint8Array {
  const headerLen = 8;
  const entryCount = 4;
  const ifdLen = 2 + entryCount * 12 + 4;
  const previewAt = headerLen + ifdLen;

  const out = new Uint8Array(previewAt + previewBytes.length);
  const view = new DataView(out.buffer);

  out.set(str('II'), 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, headerLen, true);

  view.setUint16(headerLen, entryCount, true);
  const entry = (i: number, tag: number, type: number, count: number, value: number) => {
    const at = headerLen + 2 + i * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    view.setUint32(at + 8, value, true);
  };

  entry(0, 0x00fe, 4, 1, opts.reduced ? 1 : 0); // NewSubfileType
  entry(1, 0x0103, 3, 1, 7); // Compression = JPEG
  entry(2, 0x0111, 4, 1, previewAt); // StripOffsets
  entry(3, 0x0117, 4, 1, previewBytes.length); // StripByteCounts
  view.setUint32(headerLen + 2 + entryCount * 12, 0, true); // no next IFD

  out.set(previewBytes, previewAt);
  return out;
}

describe('extractTiffPreview', () => {
  it('pulls the embedded JPEG out of a DNG', () => {
    const preview = jpeg(40);
    const got = extractTiffPreview(dngWithPreview(preview));
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(preview);
  });

  it('returns data that really is a JPEG', () => {
    const got = extractTiffPreview(dngWithPreview(jpeg(40)))!;
    expect(got[0]).toBe(0xff);
    expect(got[1]).toBe(0xd8);
  });

  it('still finds a preview marked as reduced resolution', () => {
    const got = extractTiffPreview(dngWithPreview(jpeg(40), { reduced: true }));
    expect(got).not.toBeNull();
  });

  it('falls back to scanning when the IFD structure is unusable', () => {
    // A TIFF header pointing at nonsense, with a JPEG sitting in the file.
    const preview = jpeg(60);
    const out = new Uint8Array(8 + preview.length);
    out.set(str('II'), 0);
    new DataView(out.buffer).setUint16(2, 42, true);
    new DataView(out.buffer).setUint32(4, 0xfffff, true); // bogus IFD offset
    out.set(preview, 8);

    const got = extractTiffPreview(out);
    expect(got).not.toBeNull();
    expect(got![0]).toBe(0xff);
  });

  it('prefers the largest JPEG when several are present', () => {
    const small = jpeg(10);
    const large = jpeg(80);
    const out = new Uint8Array(8 + small.length + large.length);
    out.set(str('II'), 0);
    new DataView(out.buffer).setUint16(2, 42, true);
    new DataView(out.buffer).setUint32(4, 0xfffff, true);
    out.set(small, 8);
    out.set(large, 8 + small.length);

    expect(extractTiffPreview(out)!.length).toBe(large.length);
  });

  it('returns null for a TIFF with no JPEG inside', () => {
    const out = new Uint8Array(64);
    out.set(str('II'), 0);
    new DataView(out.buffer).setUint16(2, 42, true);
    new DataView(out.buffer).setUint32(4, 0xfffff, true);
    expect(extractTiffPreview(out)).toBeNull();
  });

  it('refuses anything that is not a TIFF', () => {
    expect(extractTiffPreview(pad([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(extractTiffPreview(pad(str('GIF89a')))).toBeNull();
  });

  it('does not run off the end of a truncated file', () => {
    const truncated = dngWithPreview(jpeg(40)).subarray(0, 20);
    expect(() => extractTiffPreview(truncated)).not.toThrow();
  });
});
