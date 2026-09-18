import { describe, it, expect } from 'vitest';
import { createHistory } from './history';

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = createHistory({ n: 0 });
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('undoes back to the previous state', () => {
    const h = createHistory({ n: 0 });
    h.push({ n: 1 });
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toEqual({ n: 0 });
  });

  it('redoes forward again', () => {
    const h = createHistory({ n: 0 });
    h.push({ n: 1 });
    h.undo();
    expect(h.redo()).toEqual({ n: 1 });
  });

  it('discards the redo branch after a new push', () => {
    const h = createHistory({ n: 0 });
    h.push({ n: 1 });
    h.undo();
    h.push({ n: 2 });
    expect(h.canRedo()).toBe(false);
  });

  it('caps the stack at its limit', () => {
    const h = createHistory({ n: 0 }, 3);
    for (let i = 1; i <= 10; i++) h.push({ n: i });
    let steps = 0;
    while (h.canUndo()) {
      h.undo();
      steps++;
    }
    expect(steps).toBe(3);
  });

  it('returns null when there is nothing to undo', () => {
    expect(createHistory({ n: 0 }).undo()).toBeNull();
  });

  it('returns null when there is nothing to redo', () => {
    expect(createHistory({ n: 0 }).redo()).toBeNull();
  });

  it('clears both stacks on reset', () => {
    const h = createHistory({ n: 0 });
    h.push({ n: 1 });
    h.push({ n: 2 });
    h.undo();
    h.reset({ n: 99 });
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
