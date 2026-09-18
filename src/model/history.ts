export interface History<T> {
  push(state: T): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  reset(state: T): void;
}

/**
 * Snapshot-based undo.
 *
 * The document is small — objects are plain data and the source PDF bytes are
 * shared by reference rather than copied — so snapshots are cheaper and far
 * less bug-prone than tracking inverse operations for every mutation kind.
 */
export function createHistory<T>(initial: T, limit = 100): History<T> {
  let past: T[] = [];
  let present: T = initial;
  let future: T[] = [];

  return {
    push(state) {
      past.push(present);
      if (past.length > limit) past = past.slice(past.length - limit);
      present = state;
      future = [];
    },

    undo() {
      const prev = past.pop();
      if (prev === undefined) return null;
      future.unshift(present);
      present = prev;
      return present;
    },

    redo() {
      const next = future.shift();
      if (next === undefined) return null;
      past.push(present);
      present = next;
      return present;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    reset(state) {
      past = [];
      future = [];
      present = state;
    },
  };
}
