import { describe, it, expect } from 'vitest';
import {
  clampCrop,
  cropPixels,
  dragCropEdge,
  recrop,
  sourceFraction,
  type CropState,
  fitWithin,
  placeAtPoint,
  preserveAspect,
  rotatedDrawAnchor,
  FULL_CROP,
} from './images';

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWithin(100, 50, 400, 400)).toEqual({ width: 100, height: 50 });
  });

  it('scales a wide image down by its width', () => {
    expect(fitWithin(800, 400, 400, 400)).toEqual({ width: 400, height: 200 });
  });

  it('scales a tall image down by its height', () => {
    expect(fitWithin(400, 800, 400, 400)).toEqual({ width: 200, height: 400 });
  });

  it('preserves the aspect ratio exactly', () => {
    const r = fitWithin(1920, 1080, 500, 500);
    expect(r.width / r.height).toBeCloseTo(1920 / 1080, 9);
  });

  it('never returns a zero dimension for a degenerate image', () => {
    const r = fitWithin(0, 0, 400, 400);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('clampCrop', () => {
  it('leaves a valid crop untouched', () => {
    const c = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    expect(clampCrop(c)).toEqual(c);
  });

  it('pulls a crop back inside the image', () => {
    expect(clampCrop({ x: -0.2, y: -0.3, width: 0.5, height: 0.5 })).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  });

  it('shrinks a crop that runs off the right edge', () => {
    const c = clampCrop({ x: 0.8, y: 0, width: 0.5, height: 1 });
    expect(c.x + c.width).toBeLessThanOrEqual(1);
  });

  it('refuses to produce a zero-area crop', () => {
    const c = clampCrop({ x: 0.5, y: 0.5, width: 0, height: 0 });
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
  });

  it('treats the full crop as a fixed point', () => {
    expect(clampCrop(FULL_CROP)).toEqual(FULL_CROP);
  });
});

describe('cropPixels', () => {
  it('maps a full crop to the whole image', () => {
    expect(cropPixels(FULL_CROP, 800, 600)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('maps a half crop to half the pixels', () => {
    expect(cropPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 800, 600)).toEqual({
      x: 200,
      y: 300,
      width: 400,
      height: 300,
    });
  });

  it('rounds to whole pixels, since a canvas cannot take a fraction', () => {
    const r = cropPixels({ x: 1 / 3, y: 0, width: 1 / 3, height: 1 }, 100, 100);
    expect(Number.isInteger(r.x)).toBe(true);
    expect(Number.isInteger(r.width)).toBe(true);
  });

  it('never rounds down to a zero-width region', () => {
    const r = cropPixels({ x: 0, y: 0, width: 0.001, height: 0.001 }, 100, 100);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
});

describe('preserveAspect', () => {
  const origin = { x: 0, y: 0, width: 200, height: 100 }; // 2:1

  it('keeps the ratio when dragging a corner outward', () => {
    const r = preserveAspect(origin, 'se', { x: 400, y: 400 }, 2);
    expect(r.width / r.height).toBeCloseTo(2, 9);
  });

  it('anchors the opposite corner when dragging south-east', () => {
    const r = preserveAspect(origin, 'se', { x: 400, y: 400 }, 2);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('moves the origin when dragging north-west', () => {
    const r = preserveAspect(origin, 'nw', { x: -100, y: -100 }, 2);
    expect(r.x + r.width).toBeCloseTo(200, 6);
    expect(r.y + r.height).toBeCloseTo(100, 6);
    expect(r.width / r.height).toBeCloseTo(2, 9);
  });

  it('never produces a negative size', () => {
    const r = preserveAspect(origin, 'se', { x: -500, y: -500 }, 2);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('rotatedDrawAnchor', () => {
  const centre = { x: 100, y: 100 };

  it('is the plain bottom-left corner when unrotated', () => {
    const a = rotatedDrawAnchor(centre, 40, 20, 0);
    expect(a.x).toBeCloseTo(80, 9);
    expect(a.y).toBeCloseTo(90, 9);
    expect(a.degrees).toBeCloseTo(0, 9);
  });

  it('negates the angle, because PDF rotates anticlockwise and CSS clockwise', () => {
    expect(rotatedDrawAnchor(centre, 40, 20, 90).degrees).toBeCloseTo(-90, 9);
  });

  it('keeps the image centred on the same point at any angle', () => {
    // Rotating the returned anchor back about the centre must land on the
    // unrotated bottom-left corner.
    for (const deg of [0, 30, 90, 180, 270, 315]) {
      const w = 40;
      const h = 20;
      const a = rotatedDrawAnchor(centre, w, h, deg);

      // Recover the centre from the anchor by walking half the diagonal in the
      // rotated frame.
      const rad = (-deg * Math.PI) / 180;
      const cx = a.x + (w / 2) * Math.cos(rad) - (h / 2) * Math.sin(rad);
      const cy = a.y + (w / 2) * Math.sin(rad) + (h / 2) * Math.cos(rad);

      expect(cx).toBeCloseTo(centre.x, 6);
      expect(cy).toBeCloseTo(centre.y, 6);
    }
  });

  it('normalises angles beyond a full turn', () => {
    const a = rotatedDrawAnchor(centre, 40, 20, 360);
    expect(a.x).toBeCloseTo(80, 6);
    expect(a.y).toBeCloseTo(90, 6);
  });
});

describe('placeAtPoint', () => {
  const page = { width: 600, height: 800 };

  it('centres the box on the drop point', () => {
    expect(placeAtPoint(100, 50, { x: 300, y: 400 }, page)).toEqual({ x: 250, y: 375 });
  });

  it('keeps a box dropped near the left edge on the page', () => {
    expect(placeAtPoint(100, 50, { x: 10, y: 400 }, page).x).toBe(0);
  });

  it('keeps a box dropped near the right edge on the page', () => {
    const p = placeAtPoint(100, 50, { x: 595, y: 400 }, page);
    expect(p.x + 100).toBeLessThanOrEqual(page.width);
  });

  it('keeps a box dropped near the top and bottom on the page', () => {
    expect(placeAtPoint(100, 50, { x: 300, y: 5 }, page).y).toBe(0);
    const bottom = placeAtPoint(100, 50, { x: 300, y: 795 }, page);
    expect(bottom.y + 50).toBeLessThanOrEqual(page.height);
  });

  it('pins a box larger than the page to the origin rather than off it', () => {
    // Clamping naively would give a negative offset, putting the top-left
    // corner out of reach.
    expect(placeAtPoint(900, 1000, { x: 300, y: 400 }, page)).toEqual({ x: 0, y: 0 });
  });

  it('leaves a box already fully inside exactly where it was dropped', () => {
    expect(placeAtPoint(40, 40, { x: 200, y: 200 }, page)).toEqual({ x: 180, y: 180 });
  });
});

/**
 * The property cropping must preserve: a point on the page shows the same part
 * of the source image before and after a crop. If that holds for every kept
 * point, nothing was stretched, squashed or moved - only hidden.
 */
function expectPixelsStayPut(before: CropState, after: CropState, pagePoints: { x: number; y: number }[]) {
  for (const p of pagePoints) {
    const was = sourceFraction(before, p);
    const now = sourceFraction(after, p);
    expect(now.x).toBeCloseTo(was.x, 9);
    expect(now.y).toBeCloseTo(was.y, 9);
  }
}

describe('dragCropEdge', () => {
  it('moves only the dragged edge', () => {
    expect(dragCropEdge(FULL_CROP, 'e', { x: 0.5, y: 0.9 })).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
  });

  it('keeps the opposite edge anchored when cropping from the left', () => {
    const got = dragCropEdge(FULL_CROP, 'w', { x: 0.25, y: 0 });
    expect(got.x).toBe(0.25);
    expect(got.x + got.width).toBe(1);
  });

  it('moves two edges from a corner', () => {
    const got = dragCropEdge(FULL_CROP, 'nw', { x: 0.2, y: 0.3 });
    expect(got.x).toBeCloseTo(0.2, 12);
    expect(got.y).toBeCloseTo(0.3, 12);
    expect(got.width).toBeCloseTo(0.8, 12);
    expect(got.height).toBeCloseTo(0.7, 12);
  });

  it('cannot reach past the edge of the image', () => {
    expect(dragCropEdge({ x: 0.2, y: 0, width: 0.5, height: 1 }, 'w', { x: -3, y: 0 }).x).toBe(0);
    expect(dragCropEdge({ x: 0, y: 0, width: 0.5, height: 1 }, 'e', { x: 9, y: 0 }).width).toBe(1);
  });

  it('stops at a minimum size without moving the anchored edge', () => {
    const got = dragCropEdge({ x: 0.2, y: 0, width: 0.6, height: 1 }, 'w', { x: 0.99, y: 0 });
    expect(got.x + got.width).toBeCloseTo(0.8, 12);
    expect(got.width).toBeGreaterThan(0);
  });
});

describe('sourceFraction', () => {
  const state: CropState = {
    box: { x: 100, y: 200, width: 200, height: 100 },
    crop: FULL_CROP,
    rotation: 0,
  };

  it('maps the box corners to the corners of the source', () => {
    expect(sourceFraction(state, { x: 100, y: 200 })).toEqual({ x: 0, y: 0 });
    expect(sourceFraction(state, { x: 300, y: 300 })).toEqual({ x: 1, y: 1 });
  });

  it('maps through an existing crop', () => {
    const cropped = { ...state, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
    expect(sourceFraction(cropped, { x: 100, y: 200 }).x).toBeCloseTo(0.5, 12);
    expect(sourceFraction(cropped, { x: 300, y: 200 }).x).toBeCloseTo(1, 12);
  });

  it('follows the image when it is rotated', () => {
    // Turned 90 degrees clockwise about its centre (200, 250): the source's
    // top-left corner is now at the top-RIGHT of the turned image.
    const turned = { ...state, rotation: 90 };
    const got = sourceFraction(turned, { x: 250, y: 150 });
    expect(got.x).toBeCloseTo(0, 9);
    expect(got.y).toBeCloseTo(0, 9);
  });
});

describe('recrop', () => {
  const box = { x: 100, y: 200, width: 200, height: 100 };
  const full: CropState = { box, crop: FULL_CROP, rotation: 0 };

  it('shrinks the box to the kept part instead of stretching it to fill the old box', () => {
    // Cropping away the right half must halve the width and leave the height,
    // not keep a 200x100 box and stretch the left half across it.
    expect(recrop(full, { x: 0, y: 0, width: 0.5, height: 1 })).toEqual({
      x: 100,
      y: 200,
      width: 100,
      height: 100,
    });
  });

  it('moves the box when cropping from the left, so the kept part stays put', () => {
    expect(recrop(full, { x: 0.25, y: 0, width: 0.75, height: 1 })).toEqual({
      x: 150,
      y: 200,
      width: 150,
      height: 100,
    });
  });

  it('keeps the drawing scale whatever is cropped', () => {
    const crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.5 };
    const got = recrop(full, crop);
    expect(got.width / crop.width).toBeCloseTo(box.width, 9);
    expect(got.height / crop.height).toBeCloseTo(box.height, 9);
  });

  it('leaves every kept pixel where it was', () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    const after: CropState = { box: recrop(full, crop), crop, rotation: 0 };
    expectPixelsStayPut(full, after, [{ x: 150, y: 230 }, { x: 180, y: 250 }, { x: 210, y: 270 }]);
  });

  it('leaves every kept pixel where it was on a rotated image', () => {
    for (const rotation of [90, 180, 270, 37]) {
      const start: CropState = { box, crop: FULL_CROP, rotation };
      const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
      const after: CropState = { box: recrop(start, crop), crop, rotation };
      // Points chosen from inside the kept region via the source mapping, so
      // they are valid whichever way the image is turned.
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      expectPixelsStayPut(start, after, [centre, { x: centre.x + 5, y: centre.y - 3 }]);
    }
  });

  it('re-crops an already cropped image at the same scale', () => {
    const first = { x: 0, y: 0, width: 0.5, height: 1 };
    const once: CropState = { box: recrop(full, first), crop: first, rotation: 0 };
    const second = { x: 0, y: 0, width: 0.25, height: 0.5 };
    expect(recrop(once, second)).toEqual({ x: 100, y: 200, width: 50, height: 50 });
  });

  it('restores the whole image, at the same scale, when the crop is reset', () => {
    // Reset used to put the full image back into the cropped box, squashing it.
    const crop = { x: 0.25, y: 0.1, width: 0.5, height: 0.8 };
    const cropped: CropState = { box: recrop(full, crop), crop, rotation: 0 };
    const restored = recrop(cropped, FULL_CROP);
    expect(restored.x).toBeCloseTo(box.x, 9);
    expect(restored.y).toBeCloseTo(box.y, 9);
    expect(restored.width).toBeCloseTo(box.width, 9);
    expect(restored.height).toBeCloseTo(box.height, 9);
  });

  it('restores a rotated image to exactly where it started', () => {
    const start: CropState = { box, crop: FULL_CROP, rotation: 37 };
    const crop = { x: 0.3, y: 0.1, width: 0.4, height: 0.7 };
    const cropped: CropState = { box: recrop(start, crop), crop, rotation: 37 };
    const restored = recrop(cropped, FULL_CROP);
    expect(restored.x).toBeCloseTo(box.x, 9);
    expect(restored.y).toBeCloseTo(box.y, 9);
    expect(restored.width).toBeCloseTo(box.width, 9);
    expect(restored.height).toBeCloseTo(box.height, 9);
  });
});
