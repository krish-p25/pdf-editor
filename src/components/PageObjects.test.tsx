import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PageObjects, objectBoxStyle } from './PageObjects';
import type { BoxShapeObject, EditorObject, ImageObject, TextObject } from '../model/types';

afterEach(cleanup);

const rect = (over: Partial<BoxShapeObject> = {}): BoxShapeObject => ({
  id: 'r1',
  pageId: 'p1',
  kind: 'rect',
  x: 10,
  y: 20,
  width: 40,
  height: 30,
  fill: '#ff0000',
  fillOpacity: 1,
  stroke: '#000000',
  strokeWidth: 1,
  strokeOpacity: 1,
  ...over,
});

const arrow = (): EditorObject => ({
  id: 'a1',
  pageId: 'p1',
  kind: 'arrow',
  x: 0,
  y: 0,
  width: 60,
  height: 40,
  x1: 0,
  y1: 40,
  x2: 60,
  y2: 0,
  stroke: '#1d4ed8',
  strokeWidth: 2,
  strokeOpacity: 1,
  arrowHeadSize: 8,
});

const image = (over: Partial<ImageObject> = {}): ImageObject => ({
  id: 'i1',
  pageId: 'p1',
  kind: 'image',
  x: 5,
  y: 5,
  width: 50,
  height: 50,
  src: 'data:image/png;base64,AAAA',
  naturalWidth: 100,
  naturalHeight: 100,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  rotation: 0,
  opacity: 1,
  ...over,
});

const text = (): TextObject => ({
  id: 't1',
  pageId: 'p1',
  kind: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  text: 'Hello',
  fontSize: 12,
  color: '#000000',
  bold: false,
  italic: false,
  align: 'left',
  lineHeight: 1.3,
});

describe('objectBoxStyle', () => {
  it('scales position and size by the zoom', () => {
    expect(objectBoxStyle(rect(), 2)).toMatchObject({
      left: 20,
      top: 40,
      width: 80,
      height: 60,
    });
  });

  it('is identity at zoom 1', () => {
    expect(objectBoxStyle(rect(), 1)).toMatchObject({ left: 10, top: 20, width: 40, height: 30 });
  });

  it('shrinks for a thumbnail scale', () => {
    const s = objectBoxStyle(rect(), 0.25);
    expect(s).toMatchObject({ left: 2.5, top: 5, width: 10, height: 7.5 });
  });

  it('applies rotation only to a rotated image', () => {
    expect(objectBoxStyle(image({ rotation: 45 }), 1).transform).toBe('rotate(45deg)');
    expect(objectBoxStyle(image({ rotation: 0 }), 1).transform).toBeUndefined();
    expect(objectBoxStyle(rect(), 1).transform).toBeUndefined();
  });
});

describe('PageObjects', () => {
  it('renders nothing for an empty page', () => {
    const { container } = render(<PageObjects objects={[]} zoom={1} />);
    expect(container.querySelectorAll('div').length).toBe(0);
  });

  it('draws a shape', () => {
    const { container } = render(<PageObjects objects={[rect()]} zoom={1} />);
    expect(container.querySelector('svg rect')).not.toBeNull();
  });

  it('draws an arrow with its head', () => {
    const { container } = render(<PageObjects objects={[arrow()]} zoom={1} />);
    expect(container.querySelector('svg line')).not.toBeNull();
    expect(container.querySelector('svg polygon')).not.toBeNull();
  });

  it('draws an image', () => {
    const { container } = render(<PageObjects objects={[image()]} zoom={1} />);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('positions each object at its scaled box', () => {
    const { container } = render(<PageObjects objects={[rect()]} zoom={0.5} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.left).toBe('5px');
    expect(box.style.top).toBe('10px');
    expect(box.style.width).toBe('20px');
    expect(box.style.height).toBe('15px');
  });

  it('renders every object on the page', () => {
    const { container } = render(
      <PageObjects objects={[rect(), arrow(), image()]} zoom={1} />,
    );
    expect(container.children.length).toBe(3);
  });

  it('never captures pointer events, so thumbnails stay clickable', () => {
    const { container } = render(<PageObjects objects={[rect()]} zoom={1} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain('pointer-events-none');
  });

  it('tolerates a text object before its font has loaded', () => {
    // TextObjectView renders nothing until metrics arrive; a thumbnail must
    // not throw in the meantime.
    expect(() => render(<PageObjects objects={[text()]} zoom={0.25} />)).not.toThrow();
  });
});
