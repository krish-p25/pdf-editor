import { useEffect, useMemo, useRef } from 'react';
import { getLoadedFont, layoutText, lineX, primeFont, variantOf } from '../pdf/fontMetrics';
import { useStore } from '../model/store';
import type { TextObject } from '../model/types';

interface Props {
  o: TextObject;
  zoom: number;
  editing: boolean;
  onFinishEditing(): void;
}

const FAMILY = 'InterPdf, Inter, sans-serif';

/**
 * Text renders one absolutely-positioned line per laid-out line, using the
 * SAME layoutText() the exporter uses.
 *
 * The browser never wraps: each line carries white-space: pre with kerning and
 * ligatures disabled (see .pdf-text), so its advance widths match what pdf-lib
 * will draw. That makes preview/export agreement structural rather than
 * something to verify by eye.
 */
export function TextObjectView({ o, zoom, editing, onFinishEditing }: Props) {
  const variant = variantOf(o.bold, o.italic);
  const metrics = getLoadedFont(variant);
  const updateObjectTransient = useStore((s) => s.updateObjectTransient);
  const deleteObjects = useStore((s) => s.deleteObjects);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Loading a variant re-renders via the store once it resolves.
  const setError = useStore((s) => s.setError);
  useEffect(() => {
    if (!metrics) {
      primeFont(variant)
        .then(() => updateObjectTransient(o.id, {}))
        .catch(() => setError('Could not load the Inter font.'));
    }
  }, [metrics, variant, o.id, updateObjectTransient, setError]);

  const layout = useMemo(
    () => (metrics ? layoutText(metrics, o.text, o.fontSize, o.width, o.lineHeight) : null),
    [metrics, o.text, o.fontSize, o.width, o.lineHeight],
  );

  // Height is derived from the layout, never set by the user. Transient so a
  // keystroke does not push an extra history entry of its own.
  useEffect(() => {
    if (layout && Math.abs(layout.height - o.height) > 0.01) {
      updateObjectTransient(o.id, { height: layout.height });
    }
  }, [layout, o.height, o.id, updateObjectTransient]);

  useEffect(() => {
    if (editing) {
      const el = textarea.current;
      el?.focus();
      el?.setSelectionRange(0, el.value.length);
    }
  }, [editing]);

  if (!layout) return null;

  if (editing) {
    return (
      <textarea
        ref={textarea}
        value={o.text}
        onChange={(e) => updateObjectTransient(o.id, { text: e.target.value })}
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
          }
        }}
        className="pdf-text absolute left-0 top-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none ring-1 ring-accent"
        style={{
          width: o.width * zoom,
          height: Math.max(layout.height, layout.lineBoxHeight) * zoom,
          fontFamily: FAMILY,
          fontSize: o.fontSize * zoom,
          lineHeight: `${layout.lineBoxHeight * zoom}px`,
          color: o.color,
          fontWeight: o.bold ? 700 : 400,
          fontStyle: o.italic ? 'italic' : 'normal',
          textAlign: o.align,
          whiteSpace: 'pre-wrap',
        }}
      />
    );
  }

  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: o.width * zoom, height: layout.height * zoom }}
    >
      {layout.lines.map((line, i) => (
        <div
          key={i}
          className="pdf-text absolute"
          style={{
            left: lineX(layout, i, o.align, o.width) * zoom,
            top: i * layout.lineBoxHeight * zoom,
            height: layout.lineBoxHeight * zoom,
            lineHeight: `${layout.lineBoxHeight * zoom}px`,
            fontFamily: FAMILY,
            fontSize: o.fontSize * zoom,
            color: o.color,
            fontWeight: o.bold ? 700 : 400,
            fontStyle: o.italic ? 'italic' : 'normal',
          }}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}
