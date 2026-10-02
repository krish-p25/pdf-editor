import { create } from 'zustand';
import { displaySize } from '../geometry/coords';
import { fitWithin, placeAtPoint, FULL_CROP } from '../geometry/images';
import { createHistory } from './history';
import { normaliseTitle } from './title';
import type { Doc, EditorObject, ObjectId, Page, PageId, Rotation, ToolId } from './types';

let idCounter = 0;
export const nextId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${idCounter++}`;

/** The slice of state that undo/redo restores. Source bytes never change. */
interface Snapshot {
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
}

interface State {
  doc: Doc | null;
  activePageId: PageId | null;
  tool: ToolId;
  selection: ObjectId[];
  zoom: number;
  snapEnabled: boolean;
  error: string | null;

  /** Text object currently open for typing, if any. */
  editingObjectId: ObjectId | null;
  /**
   * Whether entering edit mode should select the whole text.
   *
   * True only for a freshly drawn box, whose placeholder should vanish as
   * soon as the user types. Re-entering an existing box must place the caret
   * at the end instead, or the first keystroke would wipe their content.
   */
  editSelectAll: boolean;

  /** Image currently in crop mode, if any. */
  croppingObjectId: ObjectId | null;

  loadDoc(doc: Doc): void;
  closeDoc(): void;
  setTool(t: ToolId): void;
  setActivePage(id: PageId): void;
  setZoom(z: number): void;
  setSnapEnabled(on: boolean): void;
  setError(message: string | null): void;
  /** Rename the document. */
  setTitle(title: string): void;

  select(ids: ObjectId[]): void;
  clearSelection(): void;

  /** Open a text object for typing. Selects it too, so the panel follows. */
  beginEditing(id: ObjectId, selectAll?: boolean): void;
  endEditing(): void;

  /** Enter or leave crop mode for an image. */
  setCropping(id: ObjectId | null): void;

  addObject(o: EditorObject): void;
  /** Place an image centred on the active page, scaled to fit. */
  addImage(img: { src: string; naturalWidth: number; naturalHeight: number }): void;
  /** Place an image centred on a point in page space, kept on the page. */
  addImageAt(
    img: { src: string; naturalWidth: number; naturalHeight: number },
    centre: { x: number; y: number },
  ): void;
  updateObject(id: ObjectId, patch: Partial<EditorObject>): void;
  /** Live drag updates; not recorded until commitInteraction(). */
  updateObjectTransient(id: ObjectId, patch: Partial<EditorObject>): void;
  commitInteraction(): void;
  deleteObjects(ids: ObjectId[]): void;
  bringToFront(id: ObjectId): void;
  sendToBack(id: ObjectId): void;

  reorderPages(from: number, to: number): void;
  /** Append a blank page matching the last page's visible size. */
  addBlankPage(): void;
  /** Replace the source bytes with a merged document and append its new pages. */
  appendImportedPages(sourceBytes: Uint8Array, pages: Omit<Page, 'id'>[]): void;
  deletePage(id: PageId): void;
  rotatePage(id: PageId, delta: 90 | -90): void;

  undo(): void;
  redo(): void;
}

const history = createHistory<Snapshot>({ pages: [], objects: {} });

const snapshot = (doc: Doc): Snapshot => ({
  pages: doc.pages.map((p) => ({ ...p, objectIds: [...p.objectIds] })),
  objects: Object.fromEntries(Object.entries(doc.objects).map(([k, v]) => [k, { ...v }])),
});

export const useStore = create<State>((set, get) => {
  const clone = (doc: Doc): Doc => ({
    ...doc,
    pages: doc.pages.map((p) => ({ ...p, objectIds: [...p.objectIds] })),
    objects: { ...doc.objects },
  });

  /** Apply a mutation and record it in history. */
  const mutate = (fn: (doc: Doc) => void) => {
    const { doc } = get();
    if (!doc) return;
    const next = clone(doc);
    fn(next);
    history.push(snapshot(next));
    set({ doc: next });
  };

  /** Apply a mutation WITHOUT recording history, for live drag frames. */
  const mutateTransient = (fn: (doc: Doc) => void) => {
    const { doc } = get();
    if (!doc) return;
    const next = clone(doc);
    fn(next);
    set({ doc: next });
  };

  const restore = (s: Snapshot | null) => {
    const { doc } = get();
    if (!doc || !s) return;
    set({
      doc: { ...doc, pages: s.pages, objects: s.objects },
      selection: get().selection.filter((id) => id in s.objects),
      activePageId: s.pages.some((p) => p.id === get().activePageId)
        ? get().activePageId
        : (s.pages[0]?.id ?? null),
    });
  };

  return {
    doc: null,
    activePageId: null,
    tool: 'select',
    selection: [],
    zoom: 1,
    snapEnabled: true,
    error: null,
    editingObjectId: null,
    editSelectAll: false,
    croppingObjectId: null,

    loadDoc(doc) {
      history.reset(snapshot(doc));
      set({
        doc,
        activePageId: doc.pages[0]?.id ?? null,
        selection: [],
        error: null,
        zoom: 1,
        tool: 'select',
        editingObjectId: null,
        editSelectAll: false,
        croppingObjectId: null,
      });
    },

    closeDoc() {
      history.reset({ pages: [], objects: {} });
      set({
        doc: null,
        activePageId: null,
        selection: [],
        error: null,
        editingObjectId: null,
        croppingObjectId: null,
      });
    },

    setTool: (tool) =>
      set(
        tool === 'select'
          ? { tool }
          : { tool, editingObjectId: null, croppingObjectId: null },
      ),
    setActivePage: (activePageId) =>
      set({ activePageId, selection: [], editingObjectId: null, croppingObjectId: null }),
    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, Math.round(zoom * 100) / 100)) }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
    setError: (error) => set({ error }),

    setTitle(title) {
      const { doc } = get();
      if (!doc) return;
      // Renaming is a document property, not an edit to its contents, so it
      // deliberately stays out of the undo history — Ctrl+Z after a rename
      // should undo the user's last edit, not silently revert the name.
      set({ doc: { ...doc, title: normaliseTitle(title) } });
    },

    select: (selection) => set({ selection }),
    clearSelection: () =>
      set({ selection: [], editingObjectId: null, croppingObjectId: null }),

    beginEditing(id, selectAll = false) {
      const o = get().doc?.objects[id];
      if (!o || o.kind !== 'text') return;
      set({ editingObjectId: id, editSelectAll: selectAll, selection: [id], tool: 'select' });
    },

    endEditing: () => set({ editingObjectId: null, editSelectAll: false }),

    setCropping(id) {
      if (id === null) {
        set({ croppingObjectId: null });
        return;
      }
      const o = get().doc?.objects[id];
      if (!o || o.kind !== 'image') return;
      set({ croppingObjectId: id, selection: [id], tool: 'select' });
    },

    addObject(o) {
      mutate((doc) => {
        doc.objects[o.id] = o;
        const page = doc.pages.find((p) => p.id === o.pageId);
        if (page) page.objectIds = [...page.objectIds, o.id];
      });
      set({ selection: [o.id] });
    },

    addImage(img) {
      const { doc, activePageId } = get();
      const page = doc?.pages.find((p) => p.id === activePageId);
      if (!page) return;
      get().addImageAt(img, { x: page.width / 2, y: page.height / 2 });
    },

    addImageAt(img, centre) {
      const { doc, activePageId } = get();
      const page = doc?.pages.find((p) => p.id === activePageId);
      if (!page) return;

      // Half the page is a size that reads as deliberate: big enough to see,
      // small enough to position without immediately resizing it.
      const size = fitWithin(img.naturalWidth, img.naturalHeight, page.width / 2, page.height / 2);
      const at = placeAtPoint(size.width, size.height, centre, page);

      get().addObject({
        id: nextId('obj'),
        pageId: page.id,
        kind: 'image',
        x: at.x,
        y: at.y,
        width: size.width,
        height: size.height,
        src: img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        crop: { ...FULL_CROP },
        rotation: 0,
        opacity: 1,
      });
    },

    updateObject(id, patch) {
      mutate((doc) => {
        const existing = doc.objects[id];
        if (existing) doc.objects[id] = { ...existing, ...patch } as EditorObject;
      });
    },

    updateObjectTransient(id, patch) {
      mutateTransient((doc) => {
        const existing = doc.objects[id];
        if (existing) doc.objects[id] = { ...existing, ...patch } as EditorObject;
      });
    },

    commitInteraction() {
      const { doc } = get();
      if (doc) history.push(snapshot(doc));
    },

    deleteObjects(ids) {
      mutate((doc) => {
        for (const id of ids) {
          const o = doc.objects[id];
          if (!o) continue;
          delete doc.objects[id];
          const page = doc.pages.find((p) => p.id === o.pageId);
          if (page) page.objectIds = page.objectIds.filter((x) => x !== id);
        }
      });
      set({ selection: [], editingObjectId: null, croppingObjectId: null });
    },

    bringToFront(id) {
      mutate((doc) => {
        const o = doc.objects[id];
        const page = o && doc.pages.find((p) => p.id === o.pageId);
        if (page) page.objectIds = [...page.objectIds.filter((x) => x !== id), id];
      });
    },

    sendToBack(id) {
      mutate((doc) => {
        const o = doc.objects[id];
        const page = o && doc.pages.find((p) => p.id === o.pageId);
        if (page) page.objectIds = [id, ...page.objectIds.filter((x) => x !== id)];
      });
    },

    reorderPages(from, to) {
      mutate((doc) => {
        const pages = [...doc.pages];
        const [moved] = pages.splice(from, 1);
        pages.splice(to, 0, moved);
        doc.pages = pages;
      });
    },

    addBlankPage() {
      const { doc } = get();
      const last = doc?.pages[doc.pages.length - 1];
      if (!last) return;

      // Match what the last page LOOKS like, not its stored size. A page
      // rotated 90 degrees is stored 595x842 but displays 842x595, and the
      // new page should sit beside it at the same visible size.
      const visible = displaySize(last);
      const id = nextId('page');

      mutate((d) => {
        d.pages = [
          ...d.pages,
          {
            id,
            sourceIndex: null,
            rotation: 0,
            width: visible.width,
            height: visible.height,
            objectIds: [],
          },
        ];
      });

      set({ activePageId: id, selection: [], editingObjectId: null });
    },

    appendImportedPages(sourceBytes, pages) {
      if (pages.length === 0) return;
      const firstId = nextId('page');

      mutate((d) => {
        // The merged document keeps the original pages first and in order, so
        // every sourceIndex already stored on a page still refers to the same
        // content. Only the byte array changes underneath them.
        d.sourceBytes = sourceBytes;
        d.pages = [
          ...d.pages,
          ...pages.map((p, i) => ({ ...p, id: i === 0 ? firstId : nextId('page') })),
        ];
      });

      set({ activePageId: firstId, selection: [], editingObjectId: null });
    },

    deletePage(id) {
      const { doc, activePageId } = get();
      // Never let the document become empty; there would be nothing to edit.
      if (!doc || doc.pages.length <= 1) return;
      const index = doc.pages.findIndex((p) => p.id === id);

      mutate((d) => {
        const page = d.pages.find((p) => p.id === id);
        if (page) for (const oid of page.objectIds) delete d.objects[oid];
        d.pages = d.pages.filter((p) => p.id !== id);
      });

      if (activePageId === id) {
        const pages = get().doc?.pages ?? [];
        set({
          activePageId: pages[Math.min(index, pages.length - 1)]?.id ?? null,
          selection: [],
        });
      }
    },

    rotatePage(id, delta) {
      mutate((doc) => {
        const page = doc.pages.find((p) => p.id === id);
        if (page) page.rotation = ((((page.rotation + delta) % 360) + 360) % 360) as Rotation;
      });
    },

    undo() {
      restore(history.undo());
    },
    redo() {
      restore(history.redo());
    },
  };
});

export const canUndo = () => history.canUndo();
export const canRedo = () => history.canRedo();
