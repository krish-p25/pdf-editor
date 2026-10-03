import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PropertiesPanel } from './PropertiesPanel';
import { useStore } from '../model/store';
import type { BoxShapeObject, Doc } from '../model/types';

const box = (id: string, x: number, y: number): BoxShapeObject => ({
  id,
  pageId: 'p1',
  kind: 'rect',
  x,
  y,
  width: 40,
  height: 20,
  fill: '#ffffff',
  fillOpacity: 1,
  stroke: '#000000',
  strokeWidth: 1,
  strokeOpacity: 1,
});

const doc = (): Doc => ({
  id: 'd',
  title: 'Report',
  fileName: 'report.pdf',
  sourceBytes: new Uint8Array([1]),
  pages: [
    { id: 'p1', sourceIndex: 0, rotation: 0, width: 600, height: 800, objectIds: ['a', 'b', 'c'] },
  ],
  objects: { a: box('a', 10, 10), b: box('b', 100, 50), c: box('c', 300, 90) },
});

const obj = (id: string) => useStore.getState().doc!.objects[id];

beforeEach(() => useStore.getState().loadDoc(doc()));
afterEach(cleanup);

describe('align controls', () => {
  it('aligns a multiple selection', () => {
    useStore.getState().select(['a', 'b']);
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Top' }));
    expect(obj('a').y).toBe(10);
    expect(obj('b').y).toBe(10);
  });

  it('aligns a single object to the page', () => {
    useStore.getState().select(['a']);
    render(<PropertiesPanel />);
    expect(screen.getByText('Align to page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Centre' }));
    expect(obj('a').x).toBe((600 - 40) / 2);
  });

  it('only offers even spacing for three or more', () => {
    useStore.getState().select(['a', 'b']);
    render(<PropertiesPanel />);
    expect(
      (screen.getByRole('button', { name: 'Space across' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('spaces three objects evenly', () => {
    useStore.getState().select(['a', 'b', 'c']);
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Space across' }));
    // Bounds 10..340, widths total 120, so each gap is 105.
    expect([obj('a').x, obj('b').x, obj('c').x]).toEqual([10, 155, 300]);
  });
});
