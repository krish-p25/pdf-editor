import { useEffect, useMemo, useRef } from 'react';
import {
  getLoadedFont,
  layoutStyledText,
  lineX,
  primeFont,
  variantOf,
  variantsOf,
  type FontMetrics,
  type TextLayout,
} from '../pdf/fontMetrics';
import { useStore } from '../model/store';
import { defaultStyleOf, rangeStyle, remapSpans, tidySpans } from '../model/textSpans';
import type { TextAlign, TextObject } from '../model/types';

interface Props {
  o: TextObject;
  zoom: number;
  editing: boolean;
  /** Select the existing text on entry (new boxes) rather than caret-to-end. */
  selectAll: boolean;
  onFinishEditing(): void;
}

const FAMILY = 'InterPdf, Inter, sans-serif';

/**
 * The laid-out text, drawn run by run.
 *
 * Each run is placed at its measured offset and lifted by its own ascent onto
 * the line's shared baseline, which is the identical arithmetic the exporter
 * performs — so preview/export agreement is structural rather than something
 * to verify by eye.
 */
function StyledLines({
  layout,
  align,
  boxWidth,
  zoom,
}: {
  layout: TextLayout;
  align: TextAlign;
  boxWidth: number;
  zoom: number;
}) {
  return (
    <>
      {layout.lines.map((line, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: lineX(layout, i, align, boxWidth) * zoom,
            top: line.top * zoom,
            width: line.width * zoom,
            height: line.height * zoom,
          }}
        >
          {line.runs.map((run, j) => (
            <span
              key={j}
              className="pdf-text absolute"
              style={{
                left: run.x * zoom,
                // Its line-height is exactly its ascent-to-descent span, so
                // its baseline sits `ascent` below its own top.
                top: (line.baselineOffset - run.ascent) * zoom,
                lineHeight: `${(run.ascent - run.descent) * zoom}px`,
                fontFamily: FAMILY,
                fontSize: run.style.fontSize * zoom,
                color: run.style.color,
                fontWeight: run.style.bold ? 700 : 400,
                fontStyle: run.style.italic ? 'italic' : 'normal',
                whiteSpace: 'pre',
              }}
            >
              {run.text}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * Text renders one absolutely-positioned run per styled stretch, using the
 * SAME layoutStyledText() the exporter uses. The browser never wraps: each run
 * carries white-space: pre with kerning and ligatures disabled (see
 * .pdf-text), so its advance widths match what pdf-lib will draw.
 *
 * While editing, those same runs are drawn OVER a textarea whose own text is
 * transparent. A textarea cannot render mixed styling, but it can still own
 * the caret, the native highlight and all the keyboard behaviour, so styling
 * applied to a highlight is visible immediately instead of only after
 * clicking away. The one cost is that the textarea wraps with the browser
 * algorithm while the glyphs come from ours: on a line mixing font SIZES the
 * two can disagree and put the caret slightly off. Same size, different
 * weight or colour, agrees exactly.
 */
export function TextObjectView({ o, zoom, editing, selectAll, onFinishEditing }: Props) {
  const updateObjectTransient = useStore((s) => s.updateObjectTransient);
  const deleteObjects = useStore((s) => s.deleteObjects);
  const setTextSelection = useStore((s) => s.setTextSelection);
  const styleText = useStore((s) => s.styleText);
  const setError = useStore((s) => s.setError);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // A bold span is measured with the bold font, so every variant the object
  // can need has to be fetched, not just the one the box defaults to.
  const variants = useMemo(() => variantsOf(o, o.spans), [o.bold, o.italic, o.spans]);
  const variantKey = variants.join(',');
  const missing = variants.filter((v) => !getLoadedFont(v));

  // Loading a variant re-renders via the store once it resolves.
  useEffect(() => {
    const absent = variants.filter((v) => !getLoadedFont(v));
    if (absent.length === 0) return;
    Promise.all(absent.map(primeFont))
      .then(() => updateObjectTransient(o.id, {}))
      .catch(() => setError('Could not load the Inter font.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantKey, o.id, updateObjectTransient, setError]);

  // Measure with whatever is loaded, falling back to the box default font for
  // a variant that has not arrived yet.
  //
  // Returning null until every variant is ready would UNMOUNT the textarea the
  // moment part of the text is made bold for the first time, destroying the
  // focus, the caret and the very highlight being styled - so a second press
  // would then apply to the whole box. The layout is recomputed when the real
  // variant lands, because `missing.length` is part of the dependencies.
  const fallback = getLoadedFont(variantOf(o.bold, o.italic)) ?? getLoadedFont('regular');

  const layout = useMemo(() => {
    if (!fallback) return null;
    const metrics = (s: { bold: boolean; italic: boolean }): FontMetrics =>
      getLoadedFont(variantOf(s.bold, s.italic)) ?? fallback;
    return layoutStyledText(metrics, o.text, o.spans, defaultStyleOf(o), o.width, o.lineHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fallback,
    missing.length,
    variantKey,
    o.text,
    o.spans,
    o.fontSize,
    o.color,
    o.bold,
    o.italic,
    o.width,
    o.lineHeight,
  ]);

  // Height is derived from the layout, never set by the user. Transient so a
  // keystroke does not push an extra history entry of its own.
  useEffect(() => {
    if (layout && Math.abs(layout.height - o.height) > 0.01) {
      updateObjectTransient(o.id, { height: layout.height });
    }
  }, [layout, o.height, o.id, updateObjectTransient]);

  useEffect(() => {
    if (!editing) return;
    const el = textarea.current;
    if (!el) return;
    el.focus();
    if (selectAll) {
      // A freshly drawn box: its placeholder should vanish on first keystroke.
      el.setSelectionRange(0, el.value.length);
    } else {
      // Re-entering existing text: put the caret at the end. Selecting all
      // here would mean one keystroke destroys whatever they already wrote.
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing, selectAll]);

  if (!layout) return null;

  /** Push the current highlight into the store so style controls can use it. */
  const syncSelection = () => {
    const el = textarea.current;
    if (el) setTextSelection(o.id, el.selectionStart, el.selectionEnd);
  };

  if (editing) {
    return (
      <>
        <textarea
          ref={textarea}
          value={o.text}
          onChange={(e) => {
            const next = e.target.value;
            // Spans move with the text, or the styling would detach from the
            // words it was applied to on the next keystroke.
            updateObjectTransient(o.id, {
              text: next,
              spans: tidySpans(remapSpans(o.spans, o.text, next)),
            });
          }}
          // The select event covers both mouse and keyboard selection, but
          // syncing on release too removes any doubt about ordering.
          onSelect={syncSelection}
          onMouseUp={syncSelection}
          onKeyUp={syncSelection}
          onBlur={() => {
            // An empty box would be invisible and impossible to find again.
            if (o.text.trim() === '') deleteObjects([o.id]);
            onFinishEditing();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              textarea.current?.blur();
              return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
              e.preventDefault();
              // The store reads the highlight, so make sure it is current:
              // the select event has not fired for this keystroke.
              syncSelection();
              const el = textarea.current;
              // Toggle against the styling already in the highlight, so a
              // second press undoes the first.
              const { style } = rangeStyle(
                o.text,
                o.spans,
                defaultStyleOf(o),
                el?.selectionStart ?? 0,
                el?.selectionEnd ?? 0,
              );
              styleText(o.id, e.key === 'b' ? { bold: !style.bold } : { italic: !style.italic });
            }
          }}
          className="pdf-text absolute left-0 top-0 z-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none ring-1 ring-accent"
          style={{
            width: o.width * zoom,
            height: Math.max(layout.height, layout.lineBoxHeight) * zoom,
            fontFamily: FAMILY,
            fontSize: o.fontSize * zoom,
            lineHeight: `${layout.lineBoxHeight * zoom}px`,
            // The glyphs come from the styled layer above; this element keeps
            // the caret and the highlight, which it cannot draw styled text
            // for. The caret still needs a colour of its own.
            color: 'transparent',
            caretColor: o.color,
            fontWeight: o.bold ? 700 : 400,
            fontStyle: o.italic ? 'italic' : 'normal',
            textAlign: o.align,
            whiteSpace: 'pre-wrap',
          }}
        />
        <div
          // Above the textarea so the glyphs are not covered by the native
          // selection background, which paints behind them instead.
          className="pointer-events-none absolute left-0 top-0 z-10"
          style={{ width: o.width * zoom, height: layout.height * zoom }}
        >
          <StyledLines layout={layout} align={o.align} boxWidth={o.width} zoom={zoom} />
        </div>
      </>
    );
  }

  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: o.width * zoom, height: layout.height * zoom }}
    >
      <StyledLines layout={layout} align={o.align} boxWidth={o.width} zoom={zoom} />
    </div>
  );
}
