import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ThumbnailRail } from './ThumbnailRail';
import { useStore } from '../model/store';
import type { Doc } from '../model/types';

// jsdom cannot rasterise a PDF; a thumbnail whose render fails is caught and
// simply shows no image, which is all these tests need.
const proxy = {} as PDFDocumentProxy;

const doc = (): Doc => ({
  id: 'd',
  title: 'Report',
  fileName: 'report.pdf',
  sourceBytes: new Uint8Array([1]),
  pages: [
    { id: 'p1', sourceIndex: 0, rotation: 0, width: 600, height: 800, objectIds: [] },
    { id: 'p2', sourceIndex: 1, rotation: 0, width: 600, height: 800, objectIds: [] },
  ],
  objects: {},
});

beforeEach(() => useStore.getState().loadDoc(doc()));
afterEach(cleanup);

const pageButton = (n: number) => screen.getByText(String(n)).closest('button')!;

describe('choosing a page', () => {
  it('makes it the active page', () => {
    render(<ThumbnailRail proxy={proxy} onImportPdfs={vi.fn()} />);
    fireEvent.click(pageButton(2));
    expect(useStore.getState().activePageId).toBe('p2');
  });

  it('reports the choice, so a phone layout can close its drawer', () => {
    const onPageChosen = vi.fn();
    render(<ThumbnailRail proxy={proxy} onImportPdfs={vi.fn()} onPageChosen={onPageChosen} />);
    fireEvent.click(pageButton(2));
    expect(onPageChosen).toHaveBeenCalledOnce();
  });
});

describe('page actions', () => {
  it('always shows rotate and delete on the active page, since touch has no hover', () => {
    render(<ThumbnailRail proxy={proxy} onImportPdfs={vi.fn()} />);
    const rotate = screen.getAllByRole('button', { name: 'Rotate right' });
    // Page 1 is active after loading; page 2 only reveals its actions on hover.
    expect(rotate[0].parentElement!.className).toMatch(/(^| )flex( |$)/);
    expect(rotate[1].parentElement!.className).toContain('hidden group-hover:flex');
  });
});
