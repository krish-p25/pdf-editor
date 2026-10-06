import type { ReactNode } from 'react';
import { nextId, useStore } from '../model/store';
import { headerLabel, pageNumberLabel } from '../model/pageLabels';
import { defaultStyleOf, rangeStyle, type StyleKey } from '../model/textSpans';
import { lineLength } from '../geometry/lines';
import { FULL_CROP, recrop } from '../geometry/images';
import type { AlignEdge } from '../geometry/align';
import {
  isBoxShape,
  isImage,
  isLine,
  isText,
  type EditorObject,
  type PageLabel,
  type TextObject,
} from '../model/types';

export function PropertiesPanel() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const updateObject = useStore((s) => s.updateObject);
  const deleteObjects = useStore((s) => s.deleteObjects);
  const bringToFront = useStore((s) => s.bringToFront);
  const sendToBack = useStore((s) => s.sendToBack);
  const croppingId = useStore((s) => s.croppingObjectId);
  const setCropping = useStore((s) => s.setCropping);

  const o: EditorObject | undefined =
    selection.length === 1 ? doc?.objects[selection[0]] : undefined;

  if (!o) {
    return (
      <aside className="h-full w-64 shrink-0 space-y-5 overflow-y-auto border-l border-edge bg-panel p-4 text-sm text-slate-400">
        {selection.length > 1 ? (
          <>
            <div>{selection.length} objects selected</div>
            <AlignSection ids={selection} />
          </>
        ) : (
          <PageLabelsSection />
        )}
      </aside>
    );
  }

  const set = (patch: Partial<EditorObject>) => updateObject(o.id, patch);

  return (
    <aside className="h-full w-64 shrink-0 space-y-5 overflow-y-auto border-l border-edge bg-panel p-4">
      {isText(o) ? (
        <TextSection o={o} />
      ) : isImage(o) ? (
        <Section title="Image">
          <button
            type="button"
            onClick={() => setCropping(croppingId === o.id ? null : o.id)}
            className={`w-full rounded-md border py-1.5 text-sm font-medium transition-colors ${
              croppingId === o.id
                ? 'border-accent bg-accent text-white hover:bg-blue-700'
                : 'border-accent bg-white text-accent hover:bg-blue-50'
            }`}
          >
            {croppingId === o.id ? 'Done cropping' : 'Crop'}
          </button>
          <div className="pb-1 text-xs text-slate-400">
            {croppingId === o.id
              ? 'Drag the handles to choose what to keep.'
              : 'Drag the ⟳ handle above the image to rotate.'}
          </div>

          <Row label="Rotation">
            <NumberInput
              value={round(o.rotation)}
              min={0}
              max={359}
              step={1}
              onChange={(v) => set({ rotation: ((v % 360) + 360) % 360 })}
            />
          </Row>
          <Row label="Opacity">
            <NumberInput
              value={o.opacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ opacity: clamp01(v) })}
            />
          </Row>

          <div className="flex gap-2 pt-1">
            <SmallButton
              onClick={() =>
                // The box grows back to the whole image at the same scale.
                // Resetting only the crop would squash the whole image into
                // the cropped box.
                set({
                  ...recrop({ box: o, crop: o.crop, rotation: o.rotation }, FULL_CROP),
                  crop: { ...FULL_CROP },
                })
              }
            >
              Reset crop
            </SmallButton>
            <SmallButton onClick={() => set({ rotation: 0 })}>Reset angle</SmallButton>
          </div>
          <SmallButton
            onClick={() =>
              set({
                // Restore the natural aspect ratio of the CROPPED region,
                // keeping the current width.
                height:
                  (o.width * (o.naturalHeight * o.crop.height)) /
                  Math.max(o.naturalWidth * o.crop.width, 0.001),
              })
            }
          >
            Fix aspect ratio
          </SmallButton>
        </Section>
      ) : (
        <Section title="Shape">
          {isBoxShape(o) && (
            <>
              <Row label="Fill">
                <ColorInput value={o.fill} onChange={(v) => set({ fill: v })} />
              </Row>
              <Row label="Fill opacity">
                <NumberInput
                  value={o.fillOpacity}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => set({ fillOpacity: clamp01(v) })}
                />
              </Row>
            </>
          )}
          <Row label="Outline">
            <ColorInput value={o.stroke} onChange={(v) => set({ stroke: v })} />
          </Row>
          <Row label="Width">
            <NumberInput
              value={o.strokeWidth}
              min={0}
              max={40}
              step={0.5}
              onChange={(v) => set({ strokeWidth: Math.max(0, v) })}
            />
          </Row>
          <Row label="Outline opacity">
            <NumberInput
              value={o.strokeOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ strokeOpacity: clamp01(v) })}
            />
          </Row>
          {o.kind === 'rect' && (
            <Row label="Corner radius">
              <NumberInput
                value={o.cornerRadius ?? 0}
                min={0}
                max={100}
                step={1}
                onChange={(v) => set({ cornerRadius: Math.max(0, v) })}
              />
            </Row>
          )}
          {o.kind === 'arrow' && (
            <Row label="Head size">
              <NumberInput
                value={o.arrowHeadSize ?? 10}
                min={2}
                max={60}
                step={1}
                onChange={(v) => set({ arrowHeadSize: v })}
              />
            </Row>
          )}
        </Section>
      )}

      <AlignSection ids={[o.id]} />

      <Section title="Position">
        <Row label="X">
          <NumberInput value={round(o.x)} step={1} onChange={(v) => set({ x: v })} />
        </Row>
        <Row label="Y">
          <NumberInput value={round(o.y)} step={1} onChange={(v) => set({ y: v })} />
        </Row>
        {!isLine(o) && (
          <Row label="W">
            <NumberInput
              value={round(o.width)}
              min={1}
              step={1}
              onChange={(v) => set({ width: Math.max(1, v) })}
            />
          </Row>
        )}
        {!isText(o) && !isLine(o) && (
          <Row label="H">
            <NumberInput
              value={round(o.height)}
              min={1}
              step={1}
              onChange={(v) => set({ height: Math.max(1, v) })}
            />
          </Row>
        )}
        {isText(o) && (
          <div className="text-xs text-slate-400">Height follows the text.</div>
        )}
        {isLine(o) && (
          <>
            <Row label="Length">
              <span className="w-24 text-right text-sm tabular-nums text-slate-600">
                {round(lineLength(o))}
              </span>
            </Row>
            <div className="text-xs text-slate-400">Drag either end point to reshape.</div>
          </>
        )}
      </Section>

      <Section title="Arrange">
        <div className="flex gap-2">
          <SmallButton onClick={() => bringToFront(o.id)}>Front</SmallButton>
          <SmallButton onClick={() => sendToBack(o.id)}>Back</SmallButton>
        </div>
      </Section>

      <button
        type="button"
        onClick={() => deleteObjects([o.id])}
        className="w-full rounded-md border border-red-200 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50"
      >
        Delete
      </button>
    </aside>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Controls for a text box.
 *
 * Size, colour, bold and italic apply to the highlighted characters when
 * there are any, and to the whole box otherwise. The highlight is held per
 * object rather than per editing session, because a control can take focus
 * off the textarea — a colour picker opens a native dialog — and the range
 * has to still be there afterwards.
 *
 * Line height and alignment stay box-level whatever is highlighted: one line
 * box cannot have two heights, and one line cannot have two alignments.
 */
function TextSection({ o }: { o: TextObject }) {
  const updateObject = useStore((s) => s.updateObject);
  const beginEditing = useStore((s) => s.beginEditing);
  const styleText = useStore((s) => s.styleText);
  const textSelection = useStore((s) => s.textSelection);
  const setTextSelection = useStore((s) => s.setTextSelection);

  const highlight = textSelection?.objectId === o.id ? textSelection : null;
  const { style, mixed } = highlight
    ? rangeStyle(o.text, o.spans, defaultStyleOf(o), highlight.start, highlight.end)
    : { style: defaultStyleOf(o), mixed: new Set<StyleKey>() };

  return (
    <Section title="Text">
      <button
        type="button"
        onClick={() => beginEditing(o.id, false)}
        className="w-full rounded-md border border-accent bg-white py-1.5 text-sm font-medium text-accent transition-colors hover:bg-blue-50"
      >
        Edit text
      </button>
      <div className="pb-1 text-xs text-slate-400">Or double-click the box, or press Enter.</div>

      {highlight ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-blue-50 px-2 py-1 text-xs text-accent">
          <span>{highlight.end - highlight.start} characters highlighted</span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTextSelection(o.id, 0, 0)}
            className="shrink-0 underline"
          >
            whole box
          </button>
        </div>
      ) : (
        <div className="text-xs text-slate-400">
          Highlight text while editing to style only that part.
        </div>
      )}

      <Row label="Size">
        <NumberInput
          value={style.fontSize}
          min={4}
          max={200}
          step={1}
          mixed={mixed.has('fontSize')}
          onChange={(v) => styleText(o.id, { fontSize: v })}
        />
      </Row>
      <Row label="Colour">
        <ColorInput
          value={style.color}
          mixed={mixed.has('color')}
          onChange={(v) => styleText(o.id, { color: v })}
        />
      </Row>
      <Row label="Style">
        <div className="flex gap-1">
          <Toggle
            on={style.bold}
            mixed={mixed.has('bold')}
            onClick={() => styleText(o.id, { bold: !style.bold })}
            label="B"
            bold
          />
          <Toggle
            on={style.italic}
            mixed={mixed.has('italic')}
            onClick={() => styleText(o.id, { italic: !style.italic })}
            label="I"
            italic
          />
        </div>
      </Row>

      <Row label="Line height">
        <NumberInput
          value={o.lineHeight}
          min={0.8}
          max={3}
          step={0.1}
          onChange={(v) => updateObject(o.id, { lineHeight: v })}
        />
      </Row>
      <Row label="Align">
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map((a) => (
            <Toggle
              key={a}
              on={o.align === a}
              onClick={() => updateObject(o.id, { align: a })}
              label={a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
            />
          ))}
        </div>
      </Row>
      <div className="pt-1 text-xs text-slate-400">
        Line height and alignment apply to the whole box. Font family is always Inter.
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  mixed,
}: {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  /** The highlight covers more than one value, so none of them is the truth. */
  mixed?: boolean;
}) {
  return (
    <input
      type="number"
      value={mixed ? '' : value}
      placeholder={mixed ? 'Mixed' : undefined}
      title={mixed ? 'The highlighted text mixes several values' : undefined}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value !== '' && !Number.isNaN(v)) onChange(v);
      }}
      className={`w-24 rounded border px-2 py-1 text-right text-sm tabular-nums ${
        mixed ? 'border-amber-400 placeholder:text-amber-600' : 'border-edge'
      }`}
    />
  );
}

function ColorInput({
  value,
  onChange,
  mixed,
}: {
  value: string;
  onChange(v: string): void;
  mixed?: boolean;
}) {
  return (
    <input
      type="color"
      value={value === 'none' ? '#ffffff' : value}
      title={mixed ? 'The highlighted text mixes several colours' : undefined}
      onChange={(e) => onChange(e.target.value)}
      className={`h-7 w-24 cursor-pointer rounded border ${
        mixed ? 'border-amber-400' : 'border-edge'
      }`}
    />
  );
}

function Toggle({
  on,
  onClick,
  label,
  bold,
  italic,
  mixed,
  hint,
}: {
  on: boolean;
  onClick(): void;
  label: string;
  bold?: boolean;
  italic?: boolean;
  /** Part of the highlight has this on and part has it off. */
  mixed?: boolean;
  /** Accessible name and tooltip, for a glyph that does not explain itself. */
  hint?: string;
}) {
  return (
    <button
      type="button"
      // Keep the textarea focused, so clicking a control does not discard the
      // very highlight the control is about to style.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={mixed ? 'mixed' : on}
      aria-label={hint}
      title={mixed ? 'Mixed across the highlighted text' : hint}
      className={`h-7 w-7 rounded border text-sm ${
        mixed
          ? 'border-amber-400 bg-amber-50 text-amber-700'
          : on
            ? 'border-accent bg-accent text-white'
            : 'border-edge bg-white text-slate-600'
      }`}
      style={{ fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal' }}
    >
      {label}
    </button>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 rounded border border-edge bg-white py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const ALIGN_ROWS: { edge: AlignEdge; label: string }[][] = [
  [
    { edge: 'left', label: 'Left' },
    { edge: 'hcenter', label: 'Centre' },
    { edge: 'right', label: 'Right' },
  ],
  [
    { edge: 'top', label: 'Top' },
    { edge: 'vcenter', label: 'Middle' },
    { edge: 'bottom', label: 'Bottom' },
  ],
];

/**
 * Alignment and spacing for the current selection.
 *
 * One object aligns to the page; several align to each other. Even spacing
 * needs three or more, since two objects only have one gap between them.
 */
function AlignSection({ ids }: { ids: string[] }) {
  const alignObjects = useStore((s) => s.alignObjects);
  const distributeObjects = useStore((s) => s.distributeObjects);
  const single = ids.length === 1;

  return (
    <Section title={single ? 'Align to page' : 'Align'}>
      {ALIGN_ROWS.map((row, i) => (
        <div key={i} className="flex gap-2">
          {row.map(({ edge, label }) => (
            <SmallButton key={edge} onClick={() => alignObjects(ids, edge)}>
              {label}
            </SmallButton>
          ))}
        </div>
      ))}

      {!single && (
        <>
          <div className="flex gap-2 pt-1">
            <SmallButton
              disabled={ids.length < 3}
              onClick={() => distributeObjects(ids, 'horizontal')}
            >
              Space across
            </SmallButton>
            <SmallButton
              disabled={ids.length < 3}
              onClick={() => distributeObjects(ids, 'vertical')}
            >
              Space down
            </SmallButton>
          </div>
          {ids.length < 3 && (
            <div className="text-xs text-slate-400">Select three or more to space them evenly.</div>
          )}
        </>
      )}
    </Section>
  );
}

/** Stable empty list, so the store selector does not return a new array each render. */
const NO_LABELS: PageLabel[] = [];

const ALIGN_HINTS = { left: 'Align left', center: 'Align centre', right: 'Align right' } as const;

/**
 * Headers, footers and page numbers, shown when nothing is selected.
 *
 * Every edit replaces the whole list through setPageLabels, so each change is
 * one undo step and the stored list is never mutated in place.
 */
function PageLabelsSection() {
  const labels = useStore((s) => s.doc?.pageLabels ?? NO_LABELS);
  const title = useStore((s) => s.doc?.title ?? '');
  const setPageLabels = useStore((s) => s.setPageLabels);

  const update = (id: string, patch: Partial<PageLabel>) =>
    setPageLabels(labels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id: string) => setPageLabels(labels.filter((l) => l.id !== id));
  const add = (label: PageLabel) => setPageLabels([...labels, label]);

  return (
    <Section title="Headers & footers">
      {labels.map((l) => (
        <div key={l.id} className="space-y-2 rounded-md border border-edge bg-white p-2">
          <input
            value={l.text}
            onChange={(e) => update(l.id, { text: e.target.value })}
            aria-label="Label text"
            className="w-full rounded border border-edge px-2 py-1 text-sm text-slate-700"
          />
          <Row label="Position">
            <div className="flex gap-1">
              <Toggle
                on={l.position === 'top'}
                onClick={() => update(l.id, { position: 'top' })}
                label="↑"
                hint="Top of page"
              />
              <Toggle
                on={l.position === 'bottom'}
                onClick={() => update(l.id, { position: 'bottom' })}
                label="↓"
                hint="Bottom of page"
              />
            </div>
          </Row>
          <Row label="Align">
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((a) => (
                <Toggle
                  key={a}
                  on={l.align === a}
                  onClick={() => update(l.id, { align: a })}
                  label={a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                  hint={ALIGN_HINTS[a]}
                />
              ))}
            </div>
          </Row>
          <Row label="Size">
            <NumberInput
              value={l.fontSize}
              min={4}
              max={72}
              step={1}
              onChange={(v) => update(l.id, { fontSize: v })}
            />
          </Row>
          <Row label="Colour">
            <ColorInput value={l.color} onChange={(v) => update(l.id, { color: v })} />
          </Row>
          <Row label="Margin">
            <NumberInput
              value={l.margin}
              min={0}
              max={200}
              step={1}
              onChange={(v) => update(l.id, { margin: Math.max(0, v) })}
            />
          </Row>
          <button
            type="button"
            onClick={() => remove(l.id)}
            className="w-full rounded border border-red-200 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <SmallButton onClick={() => add(pageNumberLabel(nextId('label')))}>
          Add page numbers
        </SmallButton>
        <SmallButton onClick={() => add(headerLabel(nextId('label'), title))}>Add header</SmallButton>
      </div>
      <div className="text-xs text-slate-400">
        Use {'{page}'} and {'{pages}'} for numbering. Labels follow page reordering automatically.
      </div>
    </Section>
  );
}
