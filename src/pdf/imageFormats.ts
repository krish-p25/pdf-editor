export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'heic' | 'tiff' | 'unknown';

const ascii = (b: Uint8Array, at: number, len: number): string =>
  String.fromCharCode(...b.subarray(at, at + len));

/**
 * ISO base media brands that mean "this holds HEIF/HEIC image data".
 *
 * `mif1`/`msf1` are the generic image brands Apple also emits, so a file can
 * be a HEIC without literally saying `heic`.
 */
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1',
]);

/**
 * Identify an image by its magic bytes rather than its reported MIME type.
 *
 * `File.type` is unreliable for exactly the formats being added here: most
 * browsers report an empty string for DNG, and HEIC arrives variously as
 * `image/heic`, `image/heif` or nothing at all depending on the platform the
 * file came from.
 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length < 12) return 'unknown';

  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 3) === 'GIF') return 'gif';
  if (ascii(bytes, 0, 2) === 'BM') return 'bmp';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';

  // ISO-BMFF: a length field, then 'ftyp', then the brand.
  if (ascii(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 4))) return 'heic';

  // DNG is a TIFF variant, and so is a plain .tif; both are handled the same
  // way here, by pulling out an embedded JPEG.
  const le = ascii(bytes, 0, 2) === 'II';
  const be = ascii(bytes, 0, 2) === 'MM';
  if (le || be) {
    const magic = le ? bytes[2] | (bytes[3] << 8) : (bytes[2] << 8) | bytes[3];
    if (magic === 42) return 'tiff';
  }

  return 'unknown';
}

// ── TIFF / DNG preview extraction ────────────────────────────────────────

const TAG_NEW_SUBFILE_TYPE = 0x00fe;
const TAG_COMPRESSION = 0x0103;
const TAG_STRIP_OFFSETS = 0x0111;
const TAG_STRIP_BYTE_COUNTS = 0x0117;
const TAG_SUB_IFDS = 0x014a;
const TAG_JPEG_OFFSET = 0x0201;
const TAG_JPEG_LENGTH = 0x0202;

const COMPRESSION_JPEG = 7;

/** Byte width of each TIFF field type, indexed by the type code. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};

interface Reader {
  u16(at: number): number;
  u32(at: number): number;
  length: number;
}

function reader(bytes: Uint8Array, littleEndian: boolean): Reader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    u16: (at) => view.getUint16(at, littleEndian),
    u32: (at) => view.getUint32(at, littleEndian),
    length: bytes.byteLength,
  };
}

/** Read a numeric field's values, following the offset when they do not fit inline. */
function values(r: Reader, entryAt: number, type: number, count: number): number[] {
  const size = TYPE_SIZE[type] ?? 0;
  if (size === 0 || count === 0) return [];

  const total = size * count;
  const base = total <= 4 ? entryAt + 8 : r.u32(entryAt + 8);
  const out: number[] = [];

  for (let i = 0; i < count; i++) {
    const at = base + i * size;
    if (at + size > r.length) break;
    if (size === 2) out.push(r.u16(at));
    else if (size === 4) out.push(r.u32(at));
    else if (size === 1) out.push(r.u16(at - (at % 2)) & 0xff);
  }
  return out;
}

interface Candidate {
  offset: number;
  length: number;
  /** Full-resolution previews are preferred over reduced ones. */
  reduced: boolean;
}

/** Collect JPEG blobs described by one IFD, and recurse into its SubIFDs. */
function scanIfd(r: Reader, at: number, found: Candidate[], depth: number): void {
  if (depth > 4 || at <= 0 || at + 2 > r.length) return;

  const count = r.u16(at);
  // A wildly large count means the offset was not really an IFD.
  if (count > 512) return;

  let compression = 0;
  let reduced = false;
  let stripOffset = 0;
  let stripLength = 0;
  let jpegOffset = 0;
  let jpegLength = 0;
  const subIfds: number[] = [];

  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12;
    if (entry + 12 > r.length) return;

    const tag = r.u16(entry);
    const type = r.u16(entry + 2);
    const n = r.u32(entry + 4);

    switch (tag) {
      case TAG_COMPRESSION:
        compression = values(r, entry, type, n)[0] ?? 0;
        break;
      case TAG_NEW_SUBFILE_TYPE:
        reduced = ((values(r, entry, type, n)[0] ?? 0) & 1) === 1;
        break;
      case TAG_STRIP_OFFSETS:
        stripOffset = values(r, entry, type, n)[0] ?? 0;
        break;
      case TAG_STRIP_BYTE_COUNTS:
        stripLength = values(r, entry, type, n)[0] ?? 0;
        break;
      case TAG_JPEG_OFFSET:
        jpegOffset = values(r, entry, type, n)[0] ?? 0;
        break;
      case TAG_JPEG_LENGTH:
        jpegLength = values(r, entry, type, n)[0] ?? 0;
        break;
      case TAG_SUB_IFDS:
        subIfds.push(...values(r, entry, type, n));
        break;
    }
  }

  if (compression === COMPRESSION_JPEG && stripOffset > 0 && stripLength > 0) {
    found.push({ offset: stripOffset, length: stripLength, reduced });
  }
  if (jpegOffset > 0 && jpegLength > 0) {
    found.push({ offset: jpegOffset, length: jpegLength, reduced: true });
  }

  for (const sub of subIfds) scanIfd(r, sub, found, depth + 1);

  const next = r.u32(at + 2 + count * 12);
  if (next > 0) scanIfd(r, next, found, depth + 1);
}

/** Largest run of bytes between a JPEG start and end marker. */
function scanForJpeg(bytes: Uint8Array): Uint8Array | null {
  let best: Uint8Array | null = null;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8) continue;
    for (let j = i + 2; j + 1 < bytes.length; j++) {
      if (bytes[j] !== 0xff || bytes[j + 1] !== 0xd9) continue;
      const candidate = bytes.subarray(i, j + 2);
      if (!best || candidate.length > best.length) best = candidate;
      break;
    }
  }
  return best;
}

/**
 * Pull the largest embedded JPEG preview out of a TIFF or DNG.
 *
 * A DNG holds sensor data that no browser can develop, but it almost always
 * also carries a full-size JPEG preview, which is what every file manager
 * shows. Extracting that gives a faithful picture without demosaicing raw
 * data in the browser.
 *
 * The IFD walk is preferred because it knows which previews are
 * full-resolution; a raw byte scan is the fallback for files whose structure
 * does not parse.
 */
export function extractTiffPreview(bytes: Uint8Array): Uint8Array | null {
  if (sniffImageFormat(bytes) !== 'tiff') return null;

  const littleEndian = ascii(bytes, 0, 2) === 'II';
  const found: Candidate[] = [];

  try {
    const r = reader(bytes, littleEndian);
    scanIfd(r, r.u32(4), found, 0);
  } catch {
    /* fall through to the byte scan */
  }

  const usable = found
    .filter((c) => c.offset + c.length <= bytes.length && c.length > 0)
    .filter((c) => bytes[c.offset] === 0xff && bytes[c.offset + 1] === 0xd8)
    // Full-resolution previews first, then by size.
    .sort((a, b) => Number(a.reduced) - Number(b.reduced) || b.length - a.length);

  if (usable.length > 0) {
    const best = usable[0];
    return bytes.subarray(best.offset, best.offset + best.length);
  }

  return scanForJpeg(bytes);
}
