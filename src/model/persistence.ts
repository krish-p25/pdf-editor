import { openDB, type IDBPDatabase } from 'idb';
import { migrateDoc } from './migrate';
import { titleFromFileName } from './title';
import type { Doc, EditorObject, ObjectId, Page, PageLabel } from './types';

const DB_NAME = 'pdf-editor';
const DB_VERSION = 2;

/** Full documents, including the original PDF bytes. Keyed by document id. */
const DOCS = 'documents';
/**
 * Listing metadata, keyed by the same id.
 *
 * IndexedDB can only read whole records, so listing from `documents` would
 * pull every PDF's bytes into memory just to render a few filenames. The
 * summaries are written alongside and are a few hundred bytes each.
 */
const SUMMARIES = 'summaries';

/** The v1 store: a single session under the key below. */
const V1_STORE = 'session';
const V1_KEY = 'current';

interface StoredDocument {
  id: string;
  /** Absent on records written before titles existed. */
  title?: string;
  fileName: string;
  sourceBytes: ArrayBuffer;
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
  /** Absent on records written before page labels existed. */
  pageLabels?: PageLabel[];
  savedAt: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  fileName: string;
  pageCount: number;
  /** Epoch milliseconds. */
  savedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
let openHandle: IDBPDatabase | null = null;
let available = true;

/** Ids are generated per upload, so re-uploading a file starts a new document. */
export function newDocumentId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion, _newVersion, tx) {
        if (!d.objectStoreNames.contains(DOCS)) d.createObjectStore(DOCS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(SUMMARIES)) {
          d.createObjectStore(SUMMARIES, { keyPath: 'id' });
        }

        // v1 kept a single session under one key. Carry it into the list so a
        // user upgrading does not find their document gone.
        //
        // A versionchange transaction is atomic: if anything here throws, the
        // upgrade aborts and the database stays at v1 with the data intact,
        // rather than landing half-migrated.
        if (oldVersion < 2 && d.objectStoreNames.contains(V1_STORE)) {
          const old = tx.objectStore(V1_STORE);
          void old.get(V1_KEY).then((session) => {
            if (!session) {
              d.deleteObjectStore(V1_STORE);
              return;
            }
            const s = session as Omit<StoredDocument, 'id'>;
            const id = newDocumentId();
            const record: StoredDocument = { ...s, id };
            void tx.objectStore(DOCS).put(record);
            void tx.objectStore(SUMMARIES).put(summaryOf(record));
            d.deleteObjectStore(V1_STORE);
          });
        }
      },
    }).then((handle) => {
      openHandle = handle;
      return handle;
    });
  }
  return dbPromise;
}

const summaryOf = (d: StoredDocument): DocumentSummary => ({
  id: d.id,
  // Summaries written before titles existed fall back to the filename, so an
  // older document is never listed without a name.
  title: d.title ?? titleFromFileName(d.fileName),
  fileName: d.fileName,
  pageCount: d.pages.length,
  savedAt: d.savedAt,
});

/**
 * Persistence is best-effort by design.
 *
 * A private window, a full quota or blocked site data must degrade to
 * in-memory editing rather than break the app, so every call is wrapped and a
 * failure only flips a flag. Undo history is deliberately not persisted:
 * restoring a half-remembered undo stack across sessions is more confusing
 * than starting clean.
 */
export async function saveDocument(doc: Doc): Promise<boolean> {
  if (!available) return false;
  try {
    const record: StoredDocument = {
      id: doc.id,
      title: doc.title,
      fileName: doc.fileName,
      sourceBytes: doc.sourceBytes.slice().buffer,
      pages: doc.pages,
      objects: doc.objects,
      pageLabels: doc.pageLabels,
      savedAt: Date.now(),
    };

    const handle = await db();
    const tx = handle.transaction([DOCS, SUMMARIES], 'readwrite');
    // Both stores move together, so a listing can never name a document whose
    // bytes failed to write.
    await Promise.all([
      tx.objectStore(DOCS).put(record),
      tx.objectStore(SUMMARIES).put(summaryOf(record)),
      tx.done,
    ]);
    return true;
  } catch {
    available = false;
    return false;
  }
}

export async function loadStoredDocument(id: string): Promise<Doc | null> {
  if (!available) return null;
  try {
    const handle = await db();
    const s = (await handle.get(DOCS, id)) as StoredDocument | undefined;
    if (!s) return null;
    // A document saved before a schema change is upgraded on the way in.
    return migrateDoc({
      id: s.id,
      title: s.title,
      fileName: s.fileName,
      sourceBytes: new Uint8Array(s.sourceBytes),
      pages: s.pages,
      objects: s.objects,
      pageLabels: s.pageLabels,
    });
  } catch {
    available = false;
    return null;
  }
}

/** Saved documents, most recently edited first. */
export async function listDocuments(): Promise<DocumentSummary[]> {
  if (!available) return [];
  try {
    const handle = await db();
    const all = (await handle.getAll(SUMMARIES)) as DocumentSummary[];
    // Same fallback for summaries already on disk.
    for (const s of all) s.title = s.title ?? titleFromFileName(s.fileName);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    available = false;
    return [];
  }
}

export async function deleteDocument(id: string): Promise<void> {
  try {
    const handle = await db();
    const tx = handle.transaction([DOCS, SUMMARIES], 'readwrite');
    await Promise.all([
      tx.objectStore(DOCS).delete(id),
      tx.objectStore(SUMMARIES).delete(id),
      tx.done,
    ]);
  } catch {
    /* best effort */
  }
}

export const persistenceAvailable = (): boolean => available;

/**
 * Test seam: close and forget the connection.
 *
 * Closing matters: an open connection makes deleteDatabase block indefinitely
 * rather than fail, so a test suite that only dropped the cached promise would
 * hang instead of erroring.
 */
export function resetPersistenceForTests(): void {
  openHandle?.close();
  openHandle = null;
  dbPromise = null;
  available = true;
}

export interface Autosave {
  (doc: Doc): void;
  /** Drop a pending write. */
  cancel(): void;
}

/**
 * Debounce saves so a drag does not write on every frame.
 *
 * `cancel` matters when switching documents: without it, a write queued
 * moments earlier fires after the editor has moved on and stamps the old
 * document with a newer savedAt, reordering the list for no reason.
 */
export function createAutosave(delay = 500): Autosave {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = ((doc: Doc) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void saveDocument(doc);
    }, delay);
  }) as Autosave;

  save.cancel = () => clearTimeout(timer);
  return save;
}
