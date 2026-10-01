export class ImageLoadError extends Error {}

export interface LoadedImage {
  /** Data URL, ready to render and to decode for embedding. */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Longest edge we keep. Beyond this the image is downscaled on import.
 *
 * A modern phone photo is 12 megapixels; as base64 in IndexedDB that is tens
 * of megabytes per image, for detail no PDF page can show. 2400px still
 * exceeds 300 DPI across a full A4 width.
 */
const MAX_EDGE = 2400;

/** Formats pdf-lib can embed directly, so they can be kept byte-for-byte. */
const EMBEDDABLE = new Set(['image/png', 'image/jpeg']);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageLoadError('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageLoadError('That file is not an image this browser can read.'));
    img.src = src;
  });
}

/**
 * Read an image file into a data URL plus its natural size.
 *
 * Images already small enough and in an embeddable format are kept exactly as
 * they are — re-encoding a PNG screenshot through a canvas would only lose
 * fidelity and, for a JPEG, grow the file. Anything oversized or in another
 * format (WebP, GIF, BMP) is drawn through a canvas, which both downscales it
 * and converts it to something pdf-lib can embed.
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new ImageLoadError('That file is not an image.');
  }

  const original = await readAsDataUrl(file);
  const img = await decode(original);

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_EDGE && EMBEDDABLE.has(file.type)) {
    return { src: original, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  }

  const scale = Math.min(1, MAX_EDGE / longest);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageLoadError('Could not process that image.');

  // JPEG has no alpha, so a transparent source would composite against black
  // without this. PNG keeps its transparency and needs no backdrop.
  const asJpeg = file.type === 'image/jpeg';
  if (asJpeg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  return {
    src: asJpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'),
    naturalWidth: width,
    naturalHeight: height,
  };
}

/** Decode a data URL into the raw bytes pdf-lib embeds. */
export function dataUrlToBytes(src: string): Uint8Array {
  const comma = src.indexOf(',');
  if (comma < 0) throw new ImageLoadError('Malformed image data.');
  const binary = atob(src.slice(comma + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** True when the data URL holds a JPEG rather than a PNG. */
export const isJpegDataUrl = (src: string): boolean => src.startsWith('data:image/jpeg');
