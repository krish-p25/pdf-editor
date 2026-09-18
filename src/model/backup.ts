import type { Doc, EditorObject, ObjectId, Page } from './types';

export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: 'pdf-editor-backup';
  version: number;
  savedAt: string;
  fileName: string;
  /** The original PDF bytes, base64 encoded. */
  sourceBytes: string;
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
}

export class BackupError extends Error {}

/**
 * Encode bytes as base64 in chunks.
 *
 * `String.fromCharCode(...bytes)` blows the call stack on anything more than
 * a few tens of kilobytes, and PDFs are routinely megabytes.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Serialise a whole editing session, including the original PDF, so it can be
 * downloaded and restored later or on another machine.
 */
export function serializeBackup(doc: Doc, now: Date = new Date()): string {
  const payload: BackupFile = {
    format: 'pdf-editor-backup',
    version: BACKUP_VERSION,
    savedAt: now.toISOString(),
    fileName: doc.fileName,
    sourceBytes: bytesToBase64(doc.sourceBytes),
    pages: doc.pages,
    objects: doc.objects,
  };
  return JSON.stringify(payload);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse a backup file back into a document.
 *
 * Validation is deliberate and noisy: restoring a backup is the user's safety
 * net, so a malformed file must say what is wrong rather than half-load and
 * leave them with a corrupted session.
 */
export function parseBackup(json: string): Doc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupError('That file is not valid JSON.');
  }

  if (!isRecord(raw)) throw new BackupError('That backup file is not in the expected format.');
  if (raw.format !== 'pdf-editor-backup') {
    throw new BackupError('That file is not a PDF editor backup.');
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new BackupError(
      `That backup was made by a newer version of this app (v${String(raw.version)}).`,
    );
  }
  if (typeof raw.sourceBytes !== 'string' || raw.sourceBytes === '') {
    throw new BackupError('That backup is missing its PDF data.');
  }
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    throw new BackupError('That backup has no pages.');
  }
  if (!isRecord(raw.objects)) {
    throw new BackupError('That backup has no edit data.');
  }

  let sourceBytes: Uint8Array;
  try {
    sourceBytes = base64ToBytes(raw.sourceBytes);
  } catch {
    throw new BackupError('The PDF data in that backup could not be decoded.');
  }

  return {
    fileName: typeof raw.fileName === 'string' ? raw.fileName : 'restored.pdf',
    sourceBytes,
    pages: raw.pages as Page[],
    objects: raw.objects as Record<ObjectId, EditorObject>,
  };
}

/** Filename for a downloaded backup, e.g. "report-2026-09-18.pdfedit.json". */
export function backupFileName(docFileName: string, now: Date = new Date()): string {
  const stem = docFileName.replace(/\.pdf$/i, '') || 'document';
  const date = now.toISOString().slice(0, 10);
  return `${stem}-${date}.pdfedit.json`;
}
