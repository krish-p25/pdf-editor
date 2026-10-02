import { describe, it, expect } from 'vitest';
import {
  dataUrlToBytes,
  isJpegDataUrl,
  loadImageFile,
  looksLikeImage,
  ImageLoadError,
  EXTRA_IMAGE_EXTENSIONS,
} from './imageFile';

// jsdom's Blob predates `arrayBuffer()`, which the loader uses in the browser
// just as the PDF import path does. Back it with the FileReader jsdom does have.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

const file = (name: string, type: string, bytes: number[] = []) =>
  new File([new Uint8Array(bytes)], name, { type });

const str = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

/** A TIFF header whose IFD offset points nowhere, so no preview is found. */
const emptyDng = () => {
  const out = new Uint8Array(64);
  out.set(str('II'), 0);
  const view = new DataView(out.buffer);
  view.setUint16(2, 42, true);
  view.setUint32(4, 0xfffff, true);
  return Array.from(out);
};

describe('looksLikeImage', () => {
  it('accepts anything the browser already calls an image', () => {
    expect(looksLikeImage(file('a.png', 'image/png'))).toBe(true);
    expect(looksLikeImage(file('a.jpg', 'image/jpeg'))).toBe(true);
    expect(looksLikeImage(file('a.heic', 'image/heic'))).toBe(true);
  });

  it('accepts a DNG even though the browser reports no type at all', () => {
    // This is the whole reason the helper exists: a MIME-only check would
    // reject exactly the files this feature was added for.
    expect(looksLikeImage(file('IMG_0001.dng', ''))).toBe(true);
  });

  it('accepts HEIC and TIFF by extension when the type is missing', () => {
    expect(looksLikeImage(file('photo.heic', ''))).toBe(true);
    expect(looksLikeImage(file('photo.HEIF', ''))).toBe(true);
    expect(looksLikeImage(file('scan.tiff', ''))).toBe(true);
    expect(looksLikeImage(file('scan.TIF', ''))).toBe(true);
  });

  it('still rejects non-images', () => {
    expect(looksLikeImage(file('doc.pdf', 'application/pdf'))).toBe(false);
    expect(looksLikeImage(file('notes.txt', 'text/plain'))).toBe(false);
    expect(looksLikeImage(file('archive.zip', ''))).toBe(false);
  });

  it('does not match an extension that merely contains one', () => {
    expect(looksLikeImage(file('dng', ''))).toBe(false);
    expect(looksLikeImage(file('my.dng.zip', ''))).toBe(false);
  });
});

describe('EXTRA_IMAGE_EXTENSIONS', () => {
  it('advertises every format the loader can actually handle', () => {
    for (const ext of ['.heic', '.heif', '.dng', '.tif', '.tiff']) {
      expect(EXTRA_IMAGE_EXTENSIONS).toContain(ext);
    }
  });
});

describe('loadImageFile', () => {
  it('rejects a file that is neither recognised nor typed as an image', () => {
    return expect(loadImageFile(file('notes.txt', 'text/plain', str('hello world'))))
      .rejects.toBeInstanceOf(ImageLoadError);
  });

  it('explains itself when a RAW file carries no preview', async () => {
    await expect(loadImageFile(file('IMG_0001.dng', '', emptyDng()))).rejects.toThrow(
      /no embedded preview/i,
    );
  });
});

describe('dataUrlToBytes', () => {
  it('round-trips bytes through base64', () => {
    const src = `data:image/png;base64,${btoa('\x89PNG')}`;
    expect(Array.from(dataUrlToBytes(src))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('rejects a data URL with no payload separator', () => {
    expect(() => dataUrlToBytes('data:image/png;base64')).toThrow(ImageLoadError);
  });
});

describe('isJpegDataUrl', () => {
  it('distinguishes the two embeddable formats', () => {
    expect(isJpegDataUrl('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isJpegDataUrl('data:image/png;base64,AAAA')).toBe(false);
  });
});
