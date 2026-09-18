import type { ReactNode } from 'react';
import { useStore } from '../model/store';
import { isText, type EditorObject } from '../model/types';

export function PropertiesPanel() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const updateObject = useStore((s) => s.updateObject);
  const deleteObjects = useStore((s) => s.deleteObjects);
  const bringToFront = useStore((s) => s.bringToFront);
  const sendToBack = useStore((s) => s.sendToBack);

  const o: EditorObject | undefined =
    selection.length === 1 ? doc?.objects[selection[0]] : undefined;

  if (!o) {
    return (
      <aside className="w-64 shrink-0 border-l border-edge bg-panel p-4 text-sm text-slate-400">
        {selection.length > 1 ? `${selection.length} objects selected` : 'Nothing selected'}
      </aside>
    );
  }

  const set = (patch: Partial<EditorObject>) => updateObject(o.id, patch);

  return (
    <aside className="w-64 shrink-0 space-y-5 overflow-y-auto border-l border-edge bg-panel p-4">
      {isText(o) ? (
        <Section title="Text">
          <Row label="Size">
            <NumberInput
              value={o.fontSize}
              min={4}
              max={200}
              step={1}
              onChange={(v) => set({ fontSize: v })}
            />
          </Row>
          <Row label="Colour">
            <ColorInput value={o.color} onChange={(v) => set({ color: v })} />
          </Row>
          <Row label="Line height">
            <NumberInput
              value={o.lineHeight}
              min={0.8}
              max={3}
              step={0.1}
              onChange={(v) => set({ lineHeight: v })}
            />
          </Row>
          <Row label="Style">
            <div className="flex gap-1">
              <Toggle on={o.bold} onClick={() => set({ bold: !o.bold })} label="B" bold />
              <Toggle on={o.italic} onClick={() => set({ italic: !o.italic })} label="I" italic />
            </div>
          </Row>
          <Row label="Align">
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((a) => (
                <Toggle
                  key={a}
                  on={o.align === a}
                  onClick={() => set({ align: a })}
                  label={a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                />
              ))}
            </div>
          </Row>
          <div className="pt-1 text-xs text-slate-400">Font family is always Inter.</div>
        </Section>
      ) : (
        <Section title="Shape">
          {o.kind !== 'line' && o.kind !== 'arrow' && (
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

      <Section title="Position">
        <Row label="X">
          <NumberInput value={round(o.x)} step={1} onChange={(v) => set({ x: v })} />
        </Row>
        <Row label="Y">
          <NumberInput value={round(o.y)} step={1} onChange={(v) => set({ y: v })} />
        </Row>
        <Row label="W">
          <NumberInput
            value={round(o.width)}
            min={1}
            step={1}
            onChange={(v) => set({ width: Math.max(1, v) })}
          />
        </Row>
        {!isText(o) && (
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
}: {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="w-24 rounded border border-edge px-2 py-1 text-right text-sm tabular-nums"
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <input
      type="color"
      value={value === 'none' ? '#ffffff' : value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-24 cursor-pointer rounded border border-edge"
    />
  );
}

function Toggle({
  on,
  onClick,
  label,
  bold,
  italic,
}: {
  on: boolean;
  onClick(): void;
  label: string;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-7 w-7 rounded border text-sm ${
        on ? 'border-accent bg-accent text-white' : 'border-edge bg-white text-slate-600'
      }`}
      style={{ fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal' }}
    >
      {label}
    </button>
  );
}

function SmallButton({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded border border-edge bg-white py-1 text-xs hover:bg-slate-50"
    >
      {children}
    </button>
  );
}
