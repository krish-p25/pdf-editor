import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import type { Doc, ShapeObject, TextObject } from './types';

const textObject: TextObject = {
  id: 't1',
  pageId: 'p1',
  kind: 'text',
  x: 10,
  y: 10,
  width: 100,
  height: 20,
  text: 'Hello',
  fontSize: 14,
  color: '#000000',
  bold: false,
  italic: false,
  align: 'left',
  lineHeight: 1.3,
};

const shapeObject: ShapeObject = {
  id: 's1',
  pageId: 'p1',
  kind: 'rect',
  x: 50,
  y: 50,
  width: 40,
  height: 40,
  fill: '#ffffff',
  fillOpacity: 1,
  stroke: '#000000',
  strokeWidth: 1,
  strokeOpacity: 1,
};

const doc = (): Doc => ({
  fileName: 'test.pdf',
  sourceBytes: new Uint8Array([1, 2, 3]),
  pages: [
    { id: 'p1', sourceIndex: 0, rotation: 0, width: 600, height: 800, objectIds: ['t1', 's1'] },
    { id: 'p2', sourceIndex: 1, rotation: 0, width: 600, height: 800, objectIds: [] },
  ],
  objects: { t1: { ...textObject }, s1: { ...shapeObject } },
});

beforeEach(() => {
  useStore.getState().loadDoc(doc());
});

describe('text editing lifecycle', () => {
  it('starts with nothing being edited', () => {
    expect(useStore.getState().editingObjectId).toBeNull();
  });

  it('opens a text object for editing and selects it', () => {
    useStore.getState().beginEditing('t1');
    const s = useStore.getState();
    expect(s.editingObjectId).toBe('t1');
    expect(s.selection).toEqual(['t1']);
  });

  it('defaults to caret-at-end rather than select-all', () => {
    // Re-entering existing text must not select everything, or the first
    // keystroke would destroy the user's content.
    useStore.getState().beginEditing('t1');
    expect(useStore.getState().editSelectAll).toBe(false);
  });

  it('selects all when asked, for a freshly created box', () => {
    useStore.getState().beginEditing('t1', true);
    expect(useStore.getState().editSelectAll).toBe(true);
  });

  it('refuses to edit a shape', () => {
    useStore.getState().beginEditing('s1');
    expect(useStore.getState().editingObjectId).toBeNull();
  });

  it('refuses to edit an object that does not exist', () => {
    useStore.getState().beginEditing('nope');
    expect(useStore.getState().editingObjectId).toBeNull();
  });

  it('forces the select tool so typing is not interrupted', () => {
    useStore.getState().setTool('rect');
    useStore.getState().beginEditing('t1');
    expect(useStore.getState().tool).toBe('select');
  });

  it('endEditing closes the editor and clears the select-all flag', () => {
    useStore.getState().beginEditing('t1', true);
    useStore.getState().endEditing();
    const s = useStore.getState();
    expect(s.editingObjectId).toBeNull();
    expect(s.editSelectAll).toBe(false);
  });
});

describe('editing is closed by anything that invalidates it', () => {
  it('closes when the object is deleted', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().deleteObjects(['t1']);
    expect(useStore.getState().editingObjectId).toBeNull();
  });

  it('closes when switching page', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().setActivePage('p2');
    expect(useStore.getState().editingObjectId).toBeNull();
  });

  it('closes when picking a drawing tool', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().setTool('ellipse');
    expect(useStore.getState().editingObjectId).toBeNull();
  });

  it('stays open when the select tool is re-picked', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().setTool('select');
    expect(useStore.getState().editingObjectId).toBe('t1');
  });

  it('closes when the selection is cleared', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().clearSelection();
    expect(useStore.getState().editingObjectId).toBeNull();
  });

  it('closes when a new document is loaded', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().loadDoc(doc());
    expect(useStore.getState().editingObjectId).toBeNull();
  });
});
