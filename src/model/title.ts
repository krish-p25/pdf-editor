/** Longest title we accept, to keep it renderable and storable. */
const MAX_TITLE = 200;

/**
 * The title a freshly opened file starts with: its name without the extension.
 *
 * The extension is dropped because a title is a label, not a filename — it is
 * re-attached on export rather than carried around in the editor.
 */
export function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.pdf$/i, '').trim();
  return stem === '' ? 'Untitled' : stem.slice(0, MAX_TITLE);
}

/**
 * Normalise a title the user typed.
 *
 * An all-whitespace title would leave the document looking nameless in the
 * list and produce a file called ".pdf", so it falls back rather than being
 * rejected mid-typing.
 */
export function normaliseTitle(raw: string): string {
  const trimmed = raw.trim().slice(0, MAX_TITLE);
  return trimmed === '' ? 'Untitled' : trimmed;
}

/** Characters no common filesystem will accept in a name. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Turn a title into a filename stem, without an extension.
 *
 * Titles are free text but filenames are not: a title containing a slash or a
 * colon would be silently mangled, or rejected outright, by the browser's
 * download handling. Every export - the PDF and the page images - is named from
 * this one stem, so they always agree.
 */
export function exportStem(title: string): string {
  const safe = normaliseTitle(title).replace(UNSAFE, '-').replace(/\s+/g, ' ').trim();
  return safe === '' || /^-+$/.test(safe) ? 'Untitled' : safe;
}

/** The name of the downloaded PDF. */
export function exportFileName(title: string): string {
  return `${exportStem(title)}.pdf`;
}
