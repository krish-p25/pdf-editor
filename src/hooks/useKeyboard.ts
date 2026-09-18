import { useEffect } from 'react';
import { nextId, useStore } from '../model/store';
import type { EditorObject, ToolId } from '../model/types';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  t: 'text',
  r: 'rect',
  o: 'ellipse',
  y: 'triangle',
  l: 'line',
  a: 'arrow',
};

/** True when focus is in a field, so shortcuts must not hijack typing. */
function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function useKeyboard() {
  useEffect(() => {
    let clipboard: EditorObject[] = [];

    const onKeyDown = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (inTextField(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
        return;
      }

      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
        return;
      }

      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const page = s.doc?.pages.find((p) => p.id === s.activePageId);
        if (page) s.select([...page.objectIds]);
        return;
      }

      if (mod && e.key.toLowerCase() === 'c') {
        clipboard = s.selection
          .map((id) => s.doc?.objects[id])
          .filter(Boolean) as EditorObject[];
        return;
      }

      if (mod && (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'd')) {
        e.preventDefault();
        const sources =
          e.key.toLowerCase() === 'd'
            ? (s.selection.map((id) => s.doc?.objects[id]).filter(Boolean) as EditorObject[])
            : clipboard;
        for (const src of sources) {
          if (!s.activePageId) continue;
          // Offset the copy so it does not land exactly on top of its source
          // and become impossible to grab.
          s.addObject({
            ...src,
            id: nextId('obj'),
            pageId: s.activePageId,
            x: src.x + 10,
            y: src.y + 10,
          });
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.length) {
          e.preventDefault();
          s.deleteObjects(s.selection);
        }
        return;
      }

      // Enter (and F2, the Windows convention) opens the selected text box
      // for editing, so re-editing never depends on discovering double-click.
      if ((e.key === 'Enter' || e.key === 'F2') && s.selection.length === 1) {
        const o = s.doc?.objects[s.selection[0]];
        if (o && o.kind === 'text') {
          e.preventDefault();
          s.beginEditing(o.id, false);
          return;
        }
      }

      if (e.key === 'Escape') {
        s.clearSelection();
        s.setTool('select');
        return;
      }

      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        for (const id of s.selection) {
          const o = s.doc?.objects[id];
          if (o) s.updateObject(id, { x: o.x + dx, y: o.y + dy });
        }
        return;
      }

      if (!mod && !e.altKey) {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) s.setTool(tool);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
