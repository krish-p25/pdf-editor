import { describe, it, expect, beforeEach } from 'vitest';
import { canUndo, useStore } from './store';
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
    { id: 'p2', sourceIndex: 1, rotation: 0, width: 600, height: 800, objectIds: ['t2'] },
  ],
  objects: {
    t1: { ...textObject },
    t2: { ...textObject, id: 't2', pageId: 'p2' },
    s1: { ...shapeObject },
  },
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

describe('dropping an image at a point', () => {
  const img = { src: 'data:image/png;base64,AAAA', naturalWidth: 800, naturalHeight: 400 };
  const dropped = () =>
    Object.values(useStore.getState().doc!.objects).find((o) => o.kind === 'image')!;

  it('centres the image on the drop point', () => {
    useStore.getState().addImageAt(img, { x: 300, y: 500 });
    const a = dropped();
    expect(a.x + a.width / 2).toBeCloseTo(300, 6);
    expect(a.y + a.height / 2).toBeCloseTo(500, 6);
  });

  it('scales it the same way a picked image is scaled', () => {
    useStore.getState().addImageAt(img, { x: 300, y: 400 });
    expect(dropped()).toMatchObject({ width: 300, height: 150 });
  });

  it('keeps an image dropped at the edge on the page', () => {
    // Page is 600x800 and the image is 300x150, so a drop at the far corner
    // must be pulled back rather than left hanging off.
    useStore.getState().addImageAt(img, { x: 600, y: 800 });
    const a = dropped();
    expect(a.x + a.width).toBeLessThanOrEqual(600);
    expect(a.y + a.height).toBeLessThanOrEqual(800);
  });

  it('keeps an image dropped at the origin on the page', () => {
    useStore.getState().addImageAt(img, { x: 0, y: 0 });
    const a = dropped();
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
  });

  it('starts uncropped, unrotated and opaque like any other image', () => {
    useStore.getState().addImageAt(img, { x: 100, y: 100 });
    expect(dropped()).toMatchObject({
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0,
      opacity: 1,
    });
  });

  it('is undoable', () => {
    useStore.getState().addImageAt(img, { x: 100, y: 100 });
    useStore.getState().undo();
    expect(Object.values(useStore.getState().doc!.objects).some((o) => o.kind === 'image')).toBe(
      false,
    );
  });

  it('does nothing when no document is open', () => {
    useStore.getState().closeDoc();
    useStore.getState().addImageAt(img, { x: 100, y: 100 });
    expect(useStore.getState().doc).toBeNull();
  });
});

describe('highlighting text', () => {
  it('records a highlighted range against its object', () => {
    useStore.getState().setTextSelection('t1', 1, 4);
    expect(useStore.getState().textSelection).toEqual({ objectId: 't1', start: 1, end: 4 });
  });

  it('treats a collapsed range as no highlight', () => {
    useStore.getState().setTextSelection('t1', 2, 2);
    expect(useStore.getState().textSelection).toBeNull();
  });

  it('normalises a range dragged right to left', () => {
    useStore.getState().setTextSelection('t1', 4, 1);
    expect(useStore.getState().textSelection).toMatchObject({ start: 1, end: 4 });
  });

  it('forgets the range when another object is selected', () => {
    useStore.getState().setTextSelection('t1', 1, 4);
    useStore.getState().select(['s1']);
    expect(useStore.getState().textSelection).toBeNull();
  });

  it('forgets the range when a new editing session begins', () => {
    useStore.getState().setTextSelection('t1', 1, 4);
    useStore.getState().beginEditing('t1');
    expect(useStore.getState().textSelection).toBeNull();
  });

  it('keeps the range when the textarea merely loses focus', () => {
    // A colour picker opens a native dialog and blurs the textarea; the range
    // has to survive that or the control would style the wrong thing.
    useStore.getState().beginEditing('t1');
    useStore.getState().setTextSelection('t1', 1, 4);
    useStore.getState().endEditing();
    expect(useStore.getState().textSelection).toMatchObject({ start: 1, end: 4 });
  });
});

describe('styling text', () => {
  const text = () => useStore.getState().doc!.objects.t1 as TextObject;

  it('styles only the highlighted characters', () => {
    useStore.getState().setTextSelection('t1', 0, 2);
    useStore.getState().styleText('t1', { bold: true });

    expect(text().spans).toEqual([{ start: 0, end: 2, bold: true }]);
    // The box default is untouched, so the rest of the text stays as it was.
    expect(text().bold).toBe(false);
  });

  it('styles the whole box when nothing is highlighted', () => {
    useStore.getState().styleText('t1', { bold: true });
    expect(text().bold).toBe(true);
    expect(text().spans).toBeUndefined();
  });

  it('applies a colour to just the highlight', () => {
    useStore.getState().setTextSelection('t1', 1, 3);
    useStore.getState().styleText('t1', { color: '#ff0000' });
    expect(text().spans).toEqual([{ start: 1, end: 3, color: '#ff0000' }]);
    expect(text().color).toBe('#000000');
  });

  it('applies a font size to just the highlight', () => {
    useStore.getState().setTextSelection('t1', 0, 5);
    useStore.getState().styleText('t1', { fontSize: 32 });
    expect(text().spans).toEqual([{ start: 0, end: 5, fontSize: 32 }]);
    expect(text().fontSize).toBe(14);
  });

  it('layers a second style onto the same highlight', () => {
    useStore.getState().setTextSelection('t1', 0, 2);
    useStore.getState().styleText('t1', { bold: true });
    useStore.getState().styleText('t1', { italic: true });
    expect(text().spans).toEqual([{ start: 0, end: 2, bold: true, italic: true }]);
  });

  it('splits a span when a narrower highlight is styled', () => {
    useStore.getState().setTextSelection('t1', 0, 5);
    useStore.getState().styleText('t1', { bold: true });
    useStore.getState().setTextSelection('t1', 1, 2);
    useStore.getState().styleText('t1', { color: '#00ff00' });

    expect(text().spans).toHaveLength(3);
    expect(text().spans![1]).toEqual({ start: 1, end: 2, bold: true, color: '#00ff00' });
  });

  it('turns a style off again over the same highlight', () => {
    useStore.getState().setTextSelection('t1', 0, 2);
    useStore.getState().styleText('t1', { bold: true });
    useStore.getState().styleText('t1', { bold: false });
    expect(text().spans).toEqual([{ start: 0, end: 2, bold: false }]);
  });

  it('lets a whole-box style override a range that was styled by hand', () => {
    // Otherwise "make everything bold" would visibly skip the words the user
    // had explicitly un-bolded, which reads as the control being broken.
    useStore.getState().setTextSelection('t1', 0, 2);
    useStore.getState().styleText('t1', { bold: false });
    useStore.getState().setTextSelection('t1', 0, 0);
    useStore.getState().styleText('t1', { bold: true });

    expect(text().bold).toBe(true);
    expect(text().spans).toBeUndefined();
  });

  it('leaves unrelated span properties alone when the box is restyled', () => {
    useStore.getState().setTextSelection('t1', 0, 2);
    useStore.getState().styleText('t1', { color: '#ff0000' });
    useStore.getState().setTextSelection('t1', 0, 0);
    useStore.getState().styleText('t1', { bold: true });

    expect(text().bold).toBe(true);
    expect(text().spans).toEqual([{ start: 0, end: 2, color: '#ff0000' }]);
  });

  it('ignores a highlight recorded against a different object', () => {
    useStore.getState().setTextSelection('s1', 0, 2);
    useStore.getState().styleText('t1', { bold: true });
    expect(text().bold).toBe(true);
    expect(text().spans).toBeUndefined();
  });

  it('does nothing to a shape', () => {
    useStore.getState().styleText('s1', { bold: true });
    expect(useStore.getState().doc!.objects.s1).toMatchObject({ kind: 'rect' });
  });

  it('is undoable as one step', () => {
    useStore.getState().setTextSelection('t1', 0, 2);
    useStore.getState().styleText('t1', { bold: true });
    useStore.getState().undo();
    expect((useStore.getState().doc!.objects.t1 as TextObject).spans).toBeUndefined();
  });
});

describe('reopening a text box that is already open', () => {
  it('keeps the highlight when beginEditing is called again', () => {
    // A double-click inside the textarea selects a word and then bubbles out
    // as a dblclick. Treating that as a fresh session used to discard the
    // selection the user had just made, so styling fell back to the whole box.
    useStore.getState().beginEditing('t1');
    useStore.getState().setTextSelection('t1', 1, 4);
    useStore.getState().beginEditing('t1');

    expect(useStore.getState().textSelection).toMatchObject({ start: 1, end: 4 });
    expect(useStore.getState().editingObjectId).toBe('t1');
  });

  it('still clears the highlight when a different box is opened', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().setTextSelection('t1', 1, 4);
    useStore.getState().beginEditing('t2');

    expect(useStore.getState().textSelection).toBeNull();
  });

  it('does not reset selectAll on a repeated call', () => {
    // Re-entering must not re-select everything, or one keystroke would wipe
    // the text the user came back to edit.
    useStore.getState().beginEditing('t1', false);
    useStore.getState().beginEditing('t1', true);
    expect(useStore.getState().editSelectAll).toBe(false);
  });

  it('styles only the highlight after a repeated beginEditing', () => {
    useStore.getState().beginEditing('t1');
    useStore.getState().setTextSelection('t1', 0, 2);
    useStore.getState().beginEditing('t1');
    useStore.getState().styleText('t1', { bold: true });

    const t = useStore.getState().doc!.objects.t1 as TextObject;
    expect(t.spans).toEqual([{ start: 0, end: 2, bold: true }]);
    expect(t.bold).toBe(false);
  });
});

describe('aligning objects', () => {
  const obj = (id: string) => useStore.getState().doc!.objects[id];

  it('aligns several objects to their shared left edge', () => {
    useStore.getState().alignObjects(['t1', 's1'], 'left');
    expect(obj('t1').x).toBe(10);
    expect(obj('s1').x).toBe(10);
  });

  it('aligns several objects to their shared right edge', () => {
    // t1 ends at 110, s1 at 90; both should end at 110.
    useStore.getState().alignObjects(['t1', 's1'], 'right');
    expect(obj('t1').x + obj('t1').width).toBe(110);
    expect(obj('s1').x + obj('s1').width).toBe(110);
  });

  it('centres a single object on the page', () => {
    useStore.getState().alignObjects(['s1'], 'hcenter');
    expect(obj('s1').x).toBe((600 - 40) / 2);
  });

  it('aligns to the visual edge of a rotated page', () => {
    useStore.getState().rotatePage('p1', 90);
    useStore.getState().alignObjects(['s1'], 'left');
    // Visual left of a 90-degree page is the stored bottom.
    expect(obj('s1').x).toBe(50);
    expect(obj('s1').y).toBe(760);
  });

  it('is undoable as one step', () => {
    useStore.getState().alignObjects(['t1', 's1'], 'top');
    useStore.getState().undo();
    expect(obj('t1').y).toBe(10);
    expect(obj('s1').y).toBe(50);
  });

  it('records nothing when nothing moves', () => {
    // A single object aligns to the page: the first call moves t1 to x 0, the
    // second finds it already there. If the second recorded an empty step,
    // one undo would leave t1 at 0 with history still to undo.
    useStore.getState().alignObjects(['t1'], 'left');
    useStore.getState().alignObjects(['t1'], 'left');
    useStore.getState().undo();
    expect(obj('t1').x).toBe(10);
    expect(canUndo()).toBe(false);
  });

  it('ignores objects on another page', () => {
    useStore.getState().alignObjects(['t1', 't2'], 'left');
    expect(obj('t2').x).toBe(10);
    expect(obj('t2').pageId).toBe('p2');
  });
});

describe('distributing objects', () => {
  const obj = (id: string) => useStore.getState().doc!.objects[id];

  const box = (id: string, x: number, width: number) => ({
    id,
    pageId: 'p1',
    kind: 'rect' as const,
    x,
    y: 300,
    width,
    height: 10,
    fill: '#ffffff',
    fillOpacity: 1,
    stroke: '#000000',
    strokeWidth: 1,
    strokeOpacity: 1,
  });

  it('spaces three objects evenly', () => {
    useStore.getState().addObject(box('a', 0, 10));
    useStore.getState().addObject(box('b', 15, 20));
    useStore.getState().addObject(box('c', 90, 10));

    useStore.getState().distributeObjects(['a', 'b', 'c'], 'horizontal');

    expect([obj('a').x, obj('b').x, obj('c').x]).toEqual([0, 40, 90]);
  });

  it('leaves two objects alone', () => {
    useStore.getState().distributeObjects(['t1', 's1'], 'horizontal');
    expect(obj('t1').x).toBe(10);
    expect(obj('s1').x).toBe(50);
    expect(canUndo()).toBe(false);
  });
});
