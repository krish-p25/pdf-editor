import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import {
  deleteDocument,
  listDocuments,
  loadStoredDocument,
  newDocumentId,
  resetPersistenceForTests,
  saveDocument,
} from './persistence';
import type { Doc, EditorObject, Page, PageLabel } from './types';

const DB_NAME = 'pdf-editor';

const page = (id: string, sourceIndex: number | null = 0): Page => ({
  id,
  sourceIndex,
  rotation: 0,
  width: 600,
  height: 800,
  objectIds: [],
});

const doc = (over: Partial<Doc> = {}): Doc => ({
  id: newDocumentId(),
  title: 'report',
  fileName: 'report.pdf',
  sourceBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff]),
  pages: [page('p1', 0), page('p2', 1)],
  objects: {},
  ...over,
});

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  resetPersistenceForTests();
  await deleteDb();
});

describe('saving and loading documents', () => {
  it('round-trips a document byte for byte', async () => {
    const d = doc();
    expect(await saveDocument(d)).toBe(true);

    const back = await loadStoredDocument(d.id);
    expect(back).not.toBeNull();
    expect(back!.fileName).toBe('report.pdf');
    expect(Array.from(back!.sourceBytes)).toEqual(Array.from(d.sourceBytes));
    expect(back!.pages).toEqual(d.pages);
  });

  it('returns null for an id that was never saved', async () => {
    expect(await loadStoredDocument('nope')).toBeNull();
  });

  it('keeps documents separate, so the same file can be opened twice', async () => {
    const a = doc({ fileName: 'report.pdf' });
    const b = doc({ fileName: 'report.pdf' });
    await saveDocument(a);
    await saveDocument(b);

    expect(a.id).not.toBe(b.id);
    expect(await listDocuments()).toHaveLength(2);
  });

  it('overwrites rather than duplicating when the same document is saved twice', async () => {
    const d = doc();
    await saveDocument(d);
    await saveDocument({ ...d, fileName: 'renamed.pdf' });

    const list = await listDocuments();
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toBe('renamed.pdf');
  });
});

describe('listing', () => {
  it('is empty before anything is saved', async () => {
    expect(await listDocuments()).toEqual([]);
  });

  it('reports the page count without loading the PDF bytes', async () => {
    await saveDocument(doc());
    const [summary] = await listDocuments();
    expect(summary.pageCount).toBe(2);
    expect(summary).not.toHaveProperty('sourceBytes');
  });

  it('orders most recently saved first', async () => {
    const older = doc({ fileName: 'older.pdf' });
    const newer = doc({ fileName: 'newer.pdf' });
    await saveDocument(older);
    await new Promise((r) => setTimeout(r, 5));
    await saveDocument(newer);

    expect((await listDocuments()).map((s) => s.fileName)).toEqual(['newer.pdf', 'older.pdf']);
  });
});

describe('deleting', () => {
  it('removes the document and its listing entry together', async () => {
    const d = doc();
    await saveDocument(d);
    await deleteDocument(d.id);

    expect(await listDocuments()).toEqual([]);
    expect(await loadStoredDocument(d.id)).toBeNull();
  });

  it('leaves other documents alone', async () => {
    const keep = doc({ fileName: 'keep.pdf' });
    const drop = doc({ fileName: 'drop.pdf' });
    await saveDocument(keep);
    await saveDocument(drop);

    await deleteDocument(drop.id);
    const list = await listDocuments();
    expect(list.map((s) => s.fileName)).toEqual(['keep.pdf']);
  });

  it('is harmless for an id that does not exist', async () => {
    await expect(deleteDocument('nope')).resolves.toBeUndefined();
  });
});

describe('upgrading from the single-session schema', () => {
  /** Write a database in exactly the v1 shape. */
  async function seedV1(fileName: string, bytes: number[], pages: Page[]) {
    const handle = await openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('session');
      },
    });
    await handle.put(
      'session',
      {
        fileName,
        sourceBytes: new Uint8Array(bytes).buffer,
        pages,
        objects: {} as Record<string, EditorObject>,
        savedAt: Date.now(),
      },
      'current',
    );
    handle.close();
  }

  it('carries the single saved session into the document list', async () => {
    await seedV1('legacy.pdf', [1, 2, 3], [page('p1', 0), page('p2', 1), page('p3', 2)]);

    const list = await listDocuments();
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toBe('legacy.pdf');
    expect(list[0].pageCount).toBe(3);
  });

  it('keeps the migrated PDF bytes intact', async () => {
    await seedV1('legacy.pdf', [1, 2, 3], [page('p1', 0)]);

    const [summary] = await listDocuments();
    const loaded = await loadStoredDocument(summary.id);
    expect(Array.from(loaded!.sourceBytes)).toEqual([1, 2, 3]);
  });

  it('gives the migrated document a usable id', async () => {
    await seedV1('legacy.pdf', [1], [page('p1', 0)]);

    const [summary] = await listDocuments();
    expect(typeof summary.id).toBe('string');
    expect(summary.id.length).toBeGreaterThan(0);
    expect(await loadStoredDocument(summary.id)).not.toBeNull();
  });

  it('drops the old store once migrated', async () => {
    await seedV1('legacy.pdf', [1], [page('p1', 0)]);
    await listDocuments();

    const handle = await openDB(DB_NAME);
    expect(Array.from(handle.objectStoreNames)).not.toContain('session');
    handle.close();
  });

  it('upgrades cleanly when v1 held no session at all', async () => {
    const handle = await openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('session');
      },
    });
    handle.close();

    expect(await listDocuments()).toEqual([]);
  });

  it('lets new documents be saved alongside the migrated one', async () => {
    await seedV1('legacy.pdf', [1], [page('p1', 0)]);
    await saveDocument(doc({ fileName: 'fresh.pdf' }));

    const names = (await listDocuments()).map((s) => s.fileName).sort();
    expect(names).toEqual(['fresh.pdf', 'legacy.pdf']);
  });
});

describe('page labels', () => {
  const label: PageLabel = {
    id: 'l1',
    text: 'Page {page} of {pages}',
    position: 'bottom',
    align: 'center',
    fontSize: 10,
    color: '#333333',
    margin: 24,
  };

  it('saves and restores them', async () => {
    const d = doc({ pageLabels: [label] });
    await saveDocument(d);
    expect((await loadStoredDocument(d.id))!.pageLabels).toEqual([label]);
  });

  it('loads a document saved without them', async () => {
    const d = doc();
    await saveDocument(d);
    expect((await loadStoredDocument(d.id))!.pageLabels).toBeUndefined();
  });
});
