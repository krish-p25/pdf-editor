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
  id: 'doc_test',
  title: 'test',
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

describe('adding a blank page', () => {
  it('appends a page with no source index', () => {
    useStore.getState().addBlankPage();
    const pages = useStore.getState().doc!.pages;
    expect(pages).toHaveLength(3);
    expect(pages[2].sourceIndex).toBeNull();
  });

  it('matches the size of the last page', () => {
    useStore.getState().addBlankPage();
    const pages = useStore.getState().doc!.pages;
    expect(pages[2].width).toBe(600);
    expect(pages[2].height).toBe(800);
  });

  it('matches the VISIBLE size when the last page is rotated', () => {
    // A page rotated 90 degrees is stored 600x800 but displays 800x600, so a
    // new page beside it should be 800x600 to look the same size.
    const lastId = useStore.getState().doc!.pages[1].id;
    useStore.getState().rotatePage(lastId, 90);
    useStore.getState().addBlankPage();

    const added = useStore.getState().doc!.pages[2];
    expect({ width: added.width, height: added.height }).toEqual({ width: 800, height: 600 });
    expect(added.rotation).toBe(0);
  });

  it('starts with no objects on it', () => {
    useStore.getState().addBlankPage();
    expect(useStore.getState().doc!.pages[2].objectIds).toEqual([]);
  });

  it('makes the new page active so the user lands on it', () => {
    useStore.getState().addBlankPage();
    const pages = useStore.getState().doc!.pages;
    expect(useStore.getState().activePageId).toBe(pages[2].id);
  });

  it('is undoable', () => {
    useStore.getState().addBlankPage();
    expect(useStore.getState().doc!.pages).toHaveLength(3);
    useStore.getState().undo();
    expect(useStore.getState().doc!.pages).toHaveLength(2);
  });

  it('can be deleted like any other page', () => {
    useStore.getState().addBlankPage();
    const added = useStore.getState().doc!.pages[2];
    useStore.getState().deletePage(added.id);
    expect(useStore.getState().doc!.pages).toHaveLength(2);
  });

  it('does nothing when no document is open', () => {
    useStore.getState().closeDoc();
    useStore.getState().addBlankPage();
    expect(useStore.getState().doc).toBeNull();
  });
});

describe('inserting an image', () => {
  const img = { src: 'data:image/png;base64,AAAA', naturalWidth: 800, naturalHeight: 400 };

  it('places it on the active page', () => {
    useStore.getState().addImage(img);
    const added = Object.values(useStore.getState().doc!.objects).find((o) => o.kind === 'image');
    expect(added?.pageId).toBe('p1');
  });

  it('scales it to fit within half the page, preserving aspect', () => {
    useStore.getState().addImage(img);
    const added = Object.values(useStore.getState().doc!.objects).find((o) => o.kind === 'image')!;
    // Page is 600x800; half-width is 300, so an 800x400 image lands at 300x150.
    expect(added.width).toBeCloseTo(300, 6);
    expect(added.height).toBeCloseTo(150, 6);
  });

  it('centres it on the page', () => {
    useStore.getState().addImage(img);
    const a = Object.values(useStore.getState().doc!.objects).find((o) => o.kind === 'image')!;
    expect(a.x + a.width / 2).toBeCloseTo(300, 6);
    expect(a.y + a.height / 2).toBeCloseTo(400, 6);
  });

  it('starts uncropped, unrotated and fully opaque', () => {
    useStore.getState().addImage(img);
    const a = Object.values(useStore.getState().doc!.objects).find((o) => o.kind === 'image');
    expect(a).toMatchObject({
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0,
      opacity: 1,
    });
  });

  it('selects it so it can be moved straight away', () => {
    useStore.getState().addImage(img);
    const a = Object.values(useStore.getState().doc!.objects).find((o) => o.kind === 'image')!;
    expect(useStore.getState().selection).toEqual([a.id]);
  });

  it('is undoable', () => {
    useStore.getState().addImage(img);
    useStore.getState().undo();
    const any = Object.values(useStore.getState().doc!.objects).some((o) => o.kind === 'image');
    expect(any).toBe(false);
  });

  it('does nothing when no page is active', () => {
    useStore.getState().closeDoc();
    useStore.getState().addImage(img);
    expect(useStore.getState().doc).toBeNull();
  });
});

describe('crop mode', () => {
  const img = { src: 'data:image/png;base64,AAAA', naturalWidth: 800, naturalHeight: 400 };
  const imageId = () =>
    Object.values(useStore.getState().doc!.objects).find((o) => o.kind === 'image')!.id;

  it('starts off', () => {
    expect(useStore.getState().croppingObjectId).toBeNull();
  });

  it('enters crop mode for an image', () => {
    useStore.getState().addImage(img);
    useStore.getState().setCropping(imageId());
    expect(useStore.getState().croppingObjectId).toBe(imageId());
  });

  it('refuses to crop a non-image', () => {
    useStore.getState().setCropping('t1');
    expect(useStore.getState().croppingObjectId).toBeNull();
  });

  it('leaves crop mode when a drawing tool is picked', () => {
    useStore.getState().addImage(img);
    useStore.getState().setCropping(imageId());
    useStore.getState().setTool('rect');
    expect(useStore.getState().croppingObjectId).toBeNull();
  });

  it('leaves crop mode when the selection is cleared', () => {
    useStore.getState().addImage(img);
    useStore.getState().setCropping(imageId());
    useStore.getState().clearSelection();
    expect(useStore.getState().croppingObjectId).toBeNull();
  });

  it('leaves crop mode when the image is deleted', () => {
    useStore.getState().addImage(img);
    const id = imageId();
    useStore.getState().setCropping(id);
    useStore.getState().deleteObjects([id]);
    expect(useStore.getState().croppingObjectId).toBeNull();
  });
});

describe('importing another PDF', () => {
  const merged = new Uint8Array([9, 9, 9]);
  const imported = [
    { sourceIndex: 2, rotation: 0 as const, width: 400, height: 500, objectIds: [] },
    { sourceIndex: 3, rotation: 0 as const, width: 400, height: 500, objectIds: [] },
  ];

  it('appends the new pages at the end', () => {
    useStore.getState().appendImportedPages(merged, imported);
    const pages = useStore.getState().doc!.pages;
    expect(pages).toHaveLength(4);
    expect(pages.slice(2).map((p) => p.sourceIndex)).toEqual([2, 3]);
  });

  it('leaves the existing pages and their source indices alone', () => {
    const before = useStore.getState().doc!.pages.map((p) => p.sourceIndex);
    useStore.getState().appendImportedPages(merged, imported);
    const after = useStore.getState().doc!.pages.slice(0, 2).map((p) => p.sourceIndex);
    expect(after).toEqual(before);
  });

  it('swaps in the merged source bytes', () => {
    useStore.getState().appendImportedPages(merged, imported);
    expect(Array.from(useStore.getState().doc!.sourceBytes)).toEqual([9, 9, 9]);
  });

  it('gives every imported page a distinct id', () => {
    useStore.getState().appendImportedPages(merged, imported);
    const ids = useStore.getState().doc!.pages.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('jumps to the first imported page', () => {
    useStore.getState().appendImportedPages(merged, imported);
    const pages = useStore.getState().doc!.pages;
    expect(useStore.getState().activePageId).toBe(pages[2].id);
  });

  it('carries each imported page size through', () => {
    useStore.getState().appendImportedPages(merged, imported);
    expect(useStore.getState().doc!.pages[2]).toMatchObject({ width: 400, height: 500 });
  });

  it('is undoable, restoring the original page list', () => {
    useStore.getState().appendImportedPages(merged, imported);
    expect(useStore.getState().doc!.pages).toHaveLength(4);
    useStore.getState().undo();
    expect(useStore.getState().doc!.pages).toHaveLength(2);
  });

  it('leaves imported pages reorderable like any other', () => {
    useStore.getState().appendImportedPages(merged, imported);
    useStore.getState().reorderPages(2, 0);
    expect(useStore.getState().doc!.pages[0].sourceIndex).toBe(2);
  });

  it('does nothing when the import contributed no pages', () => {
    useStore.getState().appendImportedPages(merged, []);
    expect(useStore.getState().doc!.pages).toHaveLength(2);
  });
});

describe('renaming the document', () => {
  it('updates the title', () => {
    useStore.getState().setTitle('Signed contract');
    expect(useStore.getState().doc!.title).toBe('Signed contract');
  });

  it('trims surrounding whitespace', () => {
    useStore.getState().setTitle('  Contract  ');
    expect(useStore.getState().doc!.title).toBe('Contract');
  });

  it('falls back rather than leaving the document nameless', () => {
    useStore.getState().setTitle('   ');
    expect(useStore.getState().doc!.title).toBe('Untitled');
  });

  it('leaves the original filename alone as provenance', () => {
    useStore.getState().setTitle('Renamed');
    expect(useStore.getState().doc!.fileName).toBe('test.pdf');
  });

  it('stays out of the undo history', () => {
    // Renaming is a document property, not a content edit: Ctrl+Z after a
    // rename should undo the last real edit, not silently revert the name.
    useStore.getState().updateObject('t1', { text: 'edited' });
    useStore.getState().setTitle('Renamed');
    useStore.getState().undo();

    expect(useStore.getState().doc!.title).toBe('Renamed');
    expect(useStore.getState().doc!.objects.t1).toMatchObject({ text: 'Hello' });
  });

  it('does nothing when no document is open', () => {
    useStore.getState().closeDoc();
    useStore.getState().setTitle('Nope');
    expect(useStore.getState().doc).toBeNull();
  });
});
