import type { SpanStyle, StyleSpan, TextObject } from './types';

/** Styling with every value filled in, ready to measure and draw with. */
export interface ResolvedStyle {
  bold: boolean;
  italic: boolean;
  color: string;
  fontSize: number;
}

export type StyleKey = keyof SpanStyle;

export const STYLE_KEYS: readonly StyleKey[] = ['bold', 'italic', 'color', 'fontSize'];

/** The styling a character inherits when no span overrides it. */
export const defaultStyleOf = (o: TextObject): ResolvedStyle => ({
  bold: o.bold,
  italic: o.italic,
  color: o.color,
  fontSize: o.fontSize,
});

/** Identity of a sparse override, for comparing and coalescing. */
const sparseKey = (s: SpanStyle): string =>
  `${s.bold ?? '-'}|${s.italic ?? '-'}|${s.color ?? '-'}|${s.fontSize ?? '-'}`;

const resolvedKey = (s: ResolvedStyle): string =>
  `${s.bold}|${s.italic}|${s.color}|${s.fontSize}`;

const isEmpty = (s: SpanStyle): boolean => STYLE_KEYS.every((k) => s[k] === undefined);

/** Later override wins per key, so overrides layer rather than replace. */
const merge = (base: SpanStyle, over: SpanStyle): SpanStyle => {
  const out: SpanStyle = { ...base };
  if (over.bold !== undefined) out.bold = over.bold;
  if (over.italic !== undefined) out.italic = over.italic;
  if (over.color !== undefined) out.color = over.color;
  if (over.fontSize !== undefined) out.fontSize = over.fontSize;
  return out;
};

/**
 * Expand spans into one sparse override per character.
 *
 * Range arithmetic - splitting, clipping and merging overlapping intervals by
 * hand - is where this kind of code goes subtly wrong. A text box holds
 * hundreds of characters, so expanding to an array, editing it directly and
 * coalescing back is O(n) on a trivially small n and leaves no interval cases
 * to get wrong. Overrides stay sparse here, never resolved against the box
 * defaults, so an explicit black survives a later change to the box colour.
 */
function expand(spans: readonly StyleSpan[] | undefined, length: number): SpanStyle[] {
  const chars: SpanStyle[] = new Array(length);
  for (let i = 0; i < length; i++) chars[i] = {};
  if (!spans) return chars;

  for (const span of spans) {
    if (isEmpty(span)) continue;
    const from = Math.max(0, Math.trunc(span.start));
    const to = Math.min(length, Math.trunc(span.end));
    for (let i = from; i < to; i++) chars[i] = merge(chars[i], span);
  }
  return chars;
}

/** Collapse a per-character array back into the fewest possible spans. */
function coalesce(chars: readonly SpanStyle[]): StyleSpan[] {
  const out: StyleSpan[] = [];
  let i = 0;
  while (i < chars.length) {
    if (isEmpty(chars[i])) {
      i++;
      continue;
    }
    const key = sparseKey(chars[i]);
    let j = i + 1;
    while (j < chars.length && sparseKey(chars[j]) === key) j++;
    out.push({ ...chars[i], start: i, end: j });
    i = j;
  }
  return out;
}

/**
 * Put spans into canonical form: sorted, non-overlapping, non-empty, merged
 * where adjacent and identical, and clipped to the text length.
 *
 * Everything that writes spans runs them through this, so the rest of the app
 * can assume the invariant rather than defend against it.
 */
export function normaliseSpans(
  spans: readonly StyleSpan[] | undefined,
  length: number,
): StyleSpan[] {
  return coalesce(expand(spans, length));
}

/** Drop an empty span list, so a uniform box stores no spans key at all. */
export const tidySpans = (spans: StyleSpan[]): StyleSpan[] | undefined =>
  spans.length > 0 ? spans : undefined;

/** Apply `patch` to `[start, end)`, leaving the rest of the styling alone. */
export function applySpanStyle(
  spans: readonly StyleSpan[] | undefined,
  start: number,
  end: number,
  patch: SpanStyle,
  length: number,
): StyleSpan[] {
  const chars = expand(spans, length);
  const from = Math.max(0, Math.trunc(Math.min(start, end)));
  const to = Math.min(length, Math.trunc(Math.max(start, end)));
  for (let i = from; i < to; i++) chars[i] = merge(chars[i], patch);
  return coalesce(chars);
}

/**
 * Drop one property from every span.
 *
 * Used when a style is applied to the whole box: the box-level control is
 * meant to be the final word, so making everything bold has to clear the
 * ranges that were explicitly set to not-bold. Otherwise that control would
 * appear to do nothing to exactly the text the user had styled by hand.
 */
export function clearSpanKey(
  spans: readonly StyleSpan[] | undefined,
  key: StyleKey,
  length: number,
): StyleSpan[] {
  const chars = expand(spans, length);
  for (const c of chars) delete c[key];
  return coalesce(chars);
}

/**
 * Resolve each character's full styling, interning identical results.
 *
 * Interning means consecutive characters sharing a style share one object, so
 * grouping them into runs downstream is a reference comparison rather than a
 * deep one.
 */
export function resolveChars(
  text: string,
  spans: readonly StyleSpan[] | undefined,
  defaults: ResolvedStyle,
): ResolvedStyle[] {
  const sparse = expand(spans, text.length);
  const pool = new Map<string, ResolvedStyle>();
  pool.set(resolvedKey(defaults), defaults);

  return sparse.map((over) => {
    if (isEmpty(over)) return defaults;
    const resolved: ResolvedStyle = {
      bold: over.bold ?? defaults.bold,
      italic: over.italic ?? defaults.italic,
      color: over.color ?? defaults.color,
      fontSize: over.fontSize ?? defaults.fontSize,
    };
    const key = resolvedKey(resolved);
    const hit = pool.get(key);
    if (hit) return hit;
    pool.set(key, resolved);
    return resolved;
  });
}

/** The styling in effect at one character offset. */
export function styleAt(
  text: string,
  spans: readonly StyleSpan[] | undefined,
  defaults: ResolvedStyle,
  index: number,
): ResolvedStyle {
  if (text.length === 0) return defaults;
  const at = Math.min(text.length - 1, Math.max(0, index));
  return resolveChars(text, spans, defaults)[at];
}

/**
 * The styling across a range, and which properties are not uniform within it.
 *
 * A control whose property is listed in `mixed` shows an indeterminate state
 * rather than quietly presenting one of the two values as the truth.
 */
export function rangeStyle(
  text: string,
  spans: readonly StyleSpan[] | undefined,
  defaults: ResolvedStyle,
  start: number,
  end: number,
): { style: ResolvedStyle; mixed: Set<StyleKey> } {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(text.length, Math.max(start, end));

  if (to <= from) return { style: styleAt(text, spans, defaults, from), mixed: new Set() };

  const chars = resolveChars(text, spans, defaults);
  const first = chars[from];
  const mixed = new Set<StyleKey>();
  for (let i = from + 1; i < to; i++) {
    for (const k of STYLE_KEYS) {
      if (chars[i][k] !== first[k]) mixed.add(k);
    }
  }
  return { style: first, mixed };
}

// --- Following the text as it is edited ----------------------------------

export interface TextEdit {
  /** Offset at which the change begins. */
  at: number;
  /** How many characters were removed there. */
  removed: number;
  /** How many characters were inserted there. */
  inserted: number;
}

/**
 * Infer what changed between two versions of the text.
 *
 * A textarea reports its new value, not a diff, so the edit is recovered by
 * matching the common prefix and suffix. That is exact for the single
 * contiguous change a keystroke, paste or deletion produces, which is all one
 * textarea event can represent.
 */
export function diffEdit(before: string, after: string): TextEdit {
  const max = Math.min(before.length, after.length);

  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    at: prefix,
    removed: before.length - prefix - suffix,
    inserted: after.length - prefix - suffix,
  };
}

/**
 * Styling that inserted text takes on.
 *
 * Two rules, which is what word processors converge on:
 *
 * Text that REPLACED a selection takes the styling of what it replaced, read
 * from the first character removed. Retyping a bold word has to come out
 * bold; inheriting from the plain spaces around it instead would quietly
 * strip the styling off a passage every time it was reworded.
 *
 * Text merely INSERTED takes the styling of the character to its left, so
 * typing onto the end of a bold word continues it. At offset zero there is
 * nothing to the left, so the character to the right decides instead - which
 * is also what makes typing at the very start of styled text join it rather
 * than sit outside it.
 *
 * Both rules collapse to the obvious answer in the easy case: an insertion
 * inside a uniform stretch inherits that stretch either way.
 */
function fillerFor(chars: readonly SpanStyle[], edit: TextEdit): SpanStyle {
  if (edit.removed > 0) return chars[edit.at] ?? {};
  return (edit.at > 0 ? chars[edit.at - 1] : chars[edit.at]) ?? {};
}

/**
 * Move spans so they keep covering the same text after an edit.
 *
 * Without this, deleting a character early in the box would slide every later
 * span one place along and the styling would visibly detach from the words it
 * was applied to.
 */
export function remapSpans(
  spans: readonly StyleSpan[] | undefined,
  before: string,
  after: string,
): StyleSpan[] {
  const edit = diffEdit(before, after);
  if (edit.removed === 0 && edit.inserted === 0) {
    return normaliseSpans(spans, after.length);
  }

  const chars = expand(spans, before.length);
  const filler = fillerFor(chars, edit);

  const next: SpanStyle[] = [
    ...chars.slice(0, edit.at),
    ...Array.from({ length: edit.inserted }, () => ({ ...filler })),
    ...chars.slice(edit.at + edit.removed),
  ];

  return coalesce(next.slice(0, after.length));
}
