import { openDB, type IDBPDatabase } from 'idb';
import type { Doc, EditorObject, ObjectId, Page } from './types';

const DB_NAME = 'pdf-editor';
const STORE = 'session';
const KEY = 'current';

interface StoredSession {
  fileName: string;
  sourceBytes: ArrayBuffer;
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
  savedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
let available = true;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

/**
 * Persistence is best-effort by design.
 *
 * A private window, a full quota or blocked site data must degrade to
 * in-memory editing rather than break the app, so every call is wrapped and a
 * failure only flips a flag. Undo history is deliberately not persisted:
 * restoring a half-remembered undo stack across sessions is more confusing
 * than starting clean.
 */
export async function saveSession(doc: Doc): Promise<boolean> {
  if (!available) return false;
  try {
    const payload: StoredSession = {
      fileName: doc.fileName,
      sourceBytes: doc.sourceBytes.slice().buffer,
      pages: doc.pages,
      objects: doc.objects,
      savedAt: Date.now(),
    };
    const handle = await db();
    await handle.put(STORE, payload, KEY);
    return true;
  } catch {
    available = false;
    return false;
  }
}

export async function loadSession(): Promise<Doc | null> {
  if (!available) return null;
  try {
    const handle = await db();
    const s = (await handle.get(STORE, KEY)) as StoredSession | undefined;
    if (!s) return null;
    return {
      fileName: s.fileName,
      sourceBytes: new Uint8Array(s.sourceBytes),
      pages: s.pages,
      objects: s.objects,
    };
  } catch {
    available = false;
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const handle = await db();
    await handle.delete(STORE, KEY);
  } catch {
    /* best effort */
  }
}

export const persistenceAvailable = (): boolean => available;

/** Debounce saves so a drag does not write on every frame. */
export function createAutosave(delay = 500): (doc: Doc) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (doc: Doc) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void saveSession(doc);
    }, delay);
  };
}
