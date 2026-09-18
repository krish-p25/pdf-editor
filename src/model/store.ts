import { create } from 'zustand';
import { createHistory } from './history';
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

  loadDoc(doc: Doc): void;
  closeDoc(): void;
  setTool(t: ToolId): void;
  setActivePage(id: PageId): void;
  setZoom(z: number): void;
  setSnapEnabled(on: boolean): void;
  setError(message: string | null): void;

  select(ids: ObjectId[]): void;
  clearSelection(): void;

  addObject(o: EditorObject): void;
  updateObject(id: ObjectId, patch: Partial<EditorObject>): void;
  /** Live drag updates; not recorded until commitInteraction(). */
  updateObjectTransient(id: ObjectId, patch: Partial<EditorObject>): void;
  commitInteraction(): void;
  deleteObjects(ids: ObjectId[]): void;
  bringToFront(id: ObjectId): void;
  sendToBack(id: ObjectId): void;

  reorderPages(from: number, to: number): void;
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

    loadDoc(doc) {
      history.reset(snapshot(doc));
      set({
        doc,
        activePageId: doc.pages[0]?.id ?? null,
        selection: [],
        error: null,
        zoom: 1,
        tool: 'select',
      });
    },

    closeDoc() {
      history.reset({ pages: [], objects: {} });
      set({ doc: null, activePageId: null, selection: [], error: null });
    },

    setTool: (tool) => set({ tool }),
    setActivePage: (activePageId) => set({ activePageId, selection: [] }),
    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, Math.round(zoom * 100) / 100)) }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
    setError: (error) => set({ error }),

    select: (selection) => set({ selection }),
    clearSelection: () => set({ selection: [] }),

    addObject(o) {
      mutate((doc) => {
        doc.objects[o.id] = o;
        const page = doc.pages.find((p) => p.id === o.pageId);
        if (page) page.objectIds = [...page.objectIds, o.id];
      });
      set({ selection: [o.id] });
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
      set({ selection: [] });
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
