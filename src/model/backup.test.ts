import { describe, it, expect } from 'vitest';
import {
  backupFileName,
  base64ToBytes,
  bytesToBase64,
  BackupError,
  parseBackup,
  serializeBackup,
} from './backup';
import type { Doc, ShapeObject, TextObject } from './types';

const sourceBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff]);

const textObject: TextObject = {
  id: 't1',
  pageId: 'p1',
  kind: 'text',
  x: 50,
  y: 100,
  width: 200,
  height: 40,
  text: 'Hello world',
  fontSize: 14,
  color: '#ff0000',
  bold: true,
  italic: false,
  align: 'center',
  lineHeight: 1.3,
};

const shapeObject: ShapeObject = {
  id: 's1',
  pageId: 'p1',
  kind: 'arrow',
  x: 10,
  y: 20,
  width: 80,
  height: 60,
  fill: 'none',
  fillOpacity: 1,
  stroke: '#1d4ed8',
  strokeWidth: 2,
  strokeOpacity: 0.8,
  arrowHeadSize: 10,
};

const doc: Doc = {
  fileName: 'report.pdf',
  sourceBytes,
  pages: [
    { id: 'p1', sourceIndex: 0, rotation: 90, width: 595, height: 842, objectIds: ['s1', 't1'] },
    { id: 'p2', sourceIndex: 2, rotation: 0, width: 595, height: 842, objectIds: [] },
  ],
  objects: { t1: textObject, s1: shapeObject },
};

describe('base64 round-trip', () => {
  it('round-trips arbitrary bytes', () => {
    expect(Array.from(base64ToBytes(bytesToBase64(sourceBytes)))).toEqual(Array.from(sourceBytes));
  });

  it('handles payloads larger than the chunk size without overflowing the stack', () => {
    // String.fromCharCode(...bytes) throws on large arrays; this guards the
    // chunked implementation, since real PDFs are megabytes.
    const big = new Uint8Array(300_000).map((_, i) => i % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(big)))).toEqual(Array.from(big));
  });
});

describe('serialize and parse', () => {
  it('restores the document exactly', () => {
    const restored = parseBackup(serializeBackup(doc));
    expect(restored.fileName).toBe('report.pdf');
    expect(Array.from(restored.sourceBytes)).toEqual(Array.from(sourceBytes));
    expect(restored.pages).toEqual(doc.pages);
    expect(restored.objects).toEqual(doc.objects);
  });

  it('preserves page order, rotation and z-order', () => {
    const restored = parseBackup(serializeBackup(doc));
    expect(restored.pages.map((p) => p.sourceIndex)).toEqual([0, 2]);
    expect(restored.pages[0].rotation).toBe(90);
    expect(restored.pages[0].objectIds).toEqual(['s1', 't1']);
  });

  it('preserves every styling property of a text object', () => {
    const restored = parseBackup(serializeBackup(doc));
    expect(restored.objects.t1).toEqual(textObject);
  });

  it('preserves every styling property of a shape', () => {
    const restored = parseBackup(serializeBackup(doc));
    expect(restored.objects.s1).toEqual(shapeObject);
  });

  it('writes a recognisable format marker and version', () => {
    const parsed = JSON.parse(serializeBackup(doc));
    expect(parsed.format).toBe('pdf-editor-backup');
    expect(parsed.version).toBe(1);
    expect(typeof parsed.savedAt).toBe('string');
  });
});

describe('parse validation', () => {
  const expectError = (json: string, fragment: string) => {
    expect(() => parseBackup(json)).toThrow(BackupError);
    expect(() => parseBackup(json)).toThrow(new RegExp(fragment, 'i'));
  };

  it('rejects non-JSON', () => {
    expectError('not json at all', 'not valid JSON');
  });

  it('rejects JSON that is not a backup', () => {
    expectError(JSON.stringify({ hello: 'world' }), 'not a PDF editor backup');
  });

  it('rejects a backup from a newer version', () => {
    expectError(
      JSON.stringify({ format: 'pdf-editor-backup', version: 99 }),
      'newer version',
    );
  });

  it('rejects a backup with no PDF data', () => {
    expectError(
      JSON.stringify({ format: 'pdf-editor-backup', version: 1, sourceBytes: '' }),
      'missing its PDF data',
    );
  });

  it('rejects a backup with no pages', () => {
    expectError(
      JSON.stringify({
        format: 'pdf-editor-backup',
        version: 1,
        sourceBytes: 'AAAA',
        pages: [],
      }),
      'no pages',
    );
  });

  it('rejects a backup with no objects map', () => {
    expectError(
      JSON.stringify({
        format: 'pdf-editor-backup',
        version: 1,
        sourceBytes: 'AAAA',
        pages: [{ id: 'p1' }],
      }),
      'no edit data',
    );
  });
});

describe('backupFileName', () => {
  it('strips the .pdf extension and stamps the date', () => {
    expect(backupFileName('report.pdf', new Date('2026-09-18T10:00:00Z'))).toBe(
      'report-2026-09-18.pdfedit.json',
    );
  });

  it('falls back to a generic stem for an empty name', () => {
    expect(backupFileName('', new Date('2026-09-18T10:00:00Z'))).toBe(
      'document-2026-09-18.pdfedit.json',
    );
  });
});
