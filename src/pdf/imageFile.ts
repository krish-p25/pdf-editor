import { extractTiffPreview, sniffImageFormat, type ImageFormat } from './imageFormats';

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
const EMBEDDABLE: ReadonlySet<ImageFormat> = new Set<ImageFormat>(['png', 'jpeg']);

/** Extensions the file pickers advertise, beyond the browser's own image/* set. */
export const EXTRA_IMAGE_EXTENSIONS = '.heic,.heif,.dng,.tif,.tiff';

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageLoadError('That image could not be decoded.'));
    img.src = src;
  });
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageLoadError('That image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Re-encode a decoded image as a JPEG data URL at its natural size.
 *
 * pdf-lib can only embed PNG and JPEG, so anything that arrived in another
 * format has to pass through a canvas before it can be exported.
 */
function toJpegDataUrl(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageLoadError('Could not process that image.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Try the browser's own HEIC decoder before reaching for the WASM one.
 *
 * Safari decodes HEIC natively, so on Apple platforms — where almost every
 * HEIC originates — the 3 MB converter chunk is pure waste. Returns a JPEG
 * data URL if the browser managed it, or null to fall back.
 */
async function tryNativeHeicDecode(bytes: Uint8Array): Promise<string | null> {
  let img: HTMLImageElement;
  try {
    img = await decode(bytesToDataUrl(bytes, 'image/heic'));
  } catch {
    // The browser refused the codec, which is the normal case outside Safari.
    return null;
  }

  // TODO(human): decide whether to trust this decode before using it.
  return toJpegDataUrl(img);
}

/**
 * Convert a HEIC to JPEG.
 *
 * Only Safari decodes HEIC natively — the codec is patent-encumbered, so
 * Chrome, Edge and Firefox refuse it. The decoder is a multi-megabyte WASM
 * build, so it is imported dynamically: nobody downloads it unless they
 * actually open a HEIC.
 */
async function decodeHeic(file: Blob): Promise<string> {
  try {
    const { heicTo } = await import('heic-to');
    const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
    return await blobToDataUrl(jpeg);
  } catch {
    throw new ImageLoadError('That HEIC image could not be converted.');
  }
}

/**
 * Take the embedded preview out of a TIFF or DNG.
 *
 * A DNG holds undeveloped sensor data; demosaicing it in the browser is not
 * realistic. It almost always carries a full-size JPEG preview though — the
 * same one a file manager shows — so that is what gets used.
 */
function decodeTiff(bytes: Uint8Array): string {
  const preview = extractTiffPreview(bytes);
  if (!preview) {
    throw new ImageLoadError(
      'That RAW file has no embedded preview, so it cannot be added. Export it as JPEG or PNG first.',
    );
  }
  return bytesToDataUrl(preview, 'image/jpeg');
}

/**
 * Read an image file into a data URL plus its natural size.
 *
 * Formats the browser can already draw are kept byte-for-byte when they are
 * also embeddable, since re-encoding a PNG screenshot through a canvas only
 * loses fidelity and re-encoding a JPEG grows it. Everything else is routed
 * through whichever decoder can read it and then normalised to PNG or JPEG,
 * which are the only two formats pdf-lib can embed.
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffImageFormat(bytes);

  if (format === 'unknown' && !file.type.startsWith('image/')) {
    throw new ImageLoadError('That file is not an image.');
  }

  let src: string;
  if (format === 'heic') {
    src = (await tryNativeHeicDecode(bytes)) ?? (await decodeHeic(file));
  } else if (format === 'tiff') {
    // Some browsers can draw a plain TIFF, but none can draw a DNG, and the
    // embedded preview is correct for both.
    src = decodeTiff(bytes);
  } else {
    src = bytesToDataUrl(bytes, file.type || 'application/octet-stream');
  }

  const img = await decode(src);
  const converted = format === 'heic' || format === 'tiff';

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_EDGE && (EMBEDDABLE.has(format) || converted)) {
    return { src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
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
  const asJpeg = format === 'jpeg' || converted;
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

/**
 * Whether this file is worth attempting as an image.
 *
 * Deliberately not `file.type.startsWith('image/')`: browsers report an empty
 * type for DNG, so a strict MIME check would silently reject exactly the
 * files this path exists to handle.
 */
export function looksLikeImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(heic|heif|dng|tif|tiff)$/i.test(file.name);
}
