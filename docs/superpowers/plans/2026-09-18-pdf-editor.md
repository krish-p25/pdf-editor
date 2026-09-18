# Universal PDF Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side PDF editor that loads a PDF, reorders/deletes/rotates its pages, overlays styled text boxes and shapes with snapping, and exports a new PDF matching the preview exactly.

**Architecture:** pdf.js rasterises original pages to a backdrop canvas; editable objects are DOM elements above it. Export uses pdf-lib on the original bytes, appending draw operators. A single `layoutText()` drives both DOM rendering and PDF drawing so preview and export cannot drift. Pure logic (coords, snapping, font metrics, export) lives outside React and carries the test burden.

**Tech Stack:** Vite, React 18, TypeScript, Zustand, Tailwind, `@dnd-kit`, `pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit`, Vitest. Production image: nginx:alpine.

**Spec:** `docs/superpowers/specs/2026-09-18-pdf-editor-design.md`

---

## Two verified findings that constrain the implementation

These were measured, not assumed. Do not "simplify" past them.

### 1. Text measurement must sum raw glyph advances

`fontkit.layout(text).advanceWidth` applies GPOS kerning. pdf-lib does **not** kern — it writes a plain glyph string and the viewer advances using the `/W` widths array. Measured on Inter Regular at 12pt:

| text | `layout().advanceWidth` | sum of raw advances | pdf-lib `widthOfTextAtSize` |
|---|---|---|---|
| `The quick brown fox` | 115.8750 | **116.9121** | **116.9121** |
| `AV Wa To` | 54.4453 | **56.8125** | **56.8125** |
| `Hello world` | 64.0547 | **64.0840** | **64.0840** |

So measurement is `sum(g.advanceWidth) / unitsPerEm * fontSize`.

The browser kerns by default too, so every text element **must** carry:

```css
font-kerning: none;
font-variant-ligatures: none;
font-feature-settings: "kern" 0, "liga" 0, "calt" 0;
```

Without this the DOM is ~4% narrower than the export on kern-heavy strings.

### 2. Objects are stored in UNROTATED page space

Page rotation is a **view transform only**: one CSS `rotate()` on the page container. Pointer coordinates are converted through the inverse. Snapping, layout, hit-testing and export therefore all operate in one space and need no rotation awareness. Export sets `/Rotate` and does a plain y-flip.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/model/types.ts` | `Doc`, `Page`, `TextObject`, `ShapeObject`, `Rect` |
| `src/model/store.ts` | Zustand store: document, selection, active tool |
| `src/model/history.ts` | Undo/redo snapshot stack |
| `src/model/persistence.ts` | IndexedDB autosave/restore |
| `src/geometry/coords.ts` | points↔screen, y-flip, rotation view transform |
| `src/geometry/snapping.ts` | candidate lines, spacing runs, `resolveSnap()` |
| `src/pdf/fontMetrics.ts` | Inter loading, `measureText`, `layoutText` |
| `src/pdf/loadDocument.ts` | open PDF, page sizes, encryption detection |
| `src/pdf/renderPage.ts` | page → canvas bitmap, with cache |
| `src/pdf/exportPdf.ts` | page order/rotation + object drawing |
| `src/components/*` | Toolbar, ThumbnailRail, PageCanvas, ObjectLayer, object views, SelectionBox, SnapIndicators, PropertiesPanel, DropZone |
| `src/hooks/useDragInteraction.ts` | pointer drag state machine shared by move/resize/create |
| `Dockerfile`, `docker/nginx.conf`, `docker-compose.yml` | deployment |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

- [ ] **Step 1: Create the Vite project and install dependencies**

```bash
npm create vite@latest . -- --template react-ts
npm install zustand pdfjs-dist pdf-lib @pdf-lib/fontkit @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers idb
npm install -D tailwindcss postcss autoprefixer vitest @vitest/coverage-v8 jsdom @testing-library/react
npx tailwindcss init -p
```

- [ ] **Step 2: Configure Vite for Vitest**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // pdfjs-dist ships its worker as a separate chunk; keep it un-inlined.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 3: Configure Tailwind**

`tailwind.config.js`:

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#2563eb',
        surface: '#ffffff',
        panel: '#f8fafc',
        edge: '#e2e8f0',
      },
    },
  },
  plugins: [],
};
```

`src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; }

/* Critical: the PDF export does not kern or ligate, so the preview must not either. */
.pdf-text {
  font-kerning: none;
  font-variant-ligatures: none;
  font-feature-settings: "kern" 0, "liga" 0, "calt" 0;
  white-space: pre;
}
```

- [ ] **Step 4: Add npm scripts**

In `package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "deploy": "docker build -t pdf-editor:latest . && docker compose up -d"
}
```

- [ ] **Step 5: Verify build and test runner work**

```bash
npm run build
npm test
```

Expected: build succeeds and writes `dist/`. `npm test` reports "No test files found" (exit 0 is fine at this stage).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Scaffold Vite React TypeScript project with Tailwind and Vitest"
```

---

## Task 2: Vendor the Inter fonts

Inter must be bundled so the app works offline and export never depends on a CDN. `@fontsource/inter` ships only subsetted `.woff`/`.woff2` — unusable for embedding. `@expo-google-fonts/inter` ships full unsubsetted TTFs; we take the four files and vendor them rather than adding a runtime dependency.

**Files:**
- Create: `public/fonts/Inter-Regular.ttf`, `Inter-Italic.ttf`, `Inter-Bold.ttf`, `Inter-BoldItalic.ttf`, `public/fonts/LICENSE.txt`

- [ ] **Step 1: Extract the four TTFs**

```bash
npm pack @expo-google-fonts/inter@0.4.2
mkdir -p public/fonts
tar -xzf expo-google-fonts-inter-0.4.2.tgz \
  package/400Regular/Inter_400Regular.ttf \
  package/400Regular_Italic/Inter_400Regular_Italic.ttf \
  package/700Bold/Inter_700Bold.ttf \
  package/700Bold_Italic/Inter_700Bold_Italic.ttf \
  package/LICENSE_FONT
cp package/400Regular/Inter_400Regular.ttf public/fonts/Inter-Regular.ttf
cp package/400Regular_Italic/Inter_400Regular_Italic.ttf public/fonts/Inter-Italic.ttf
cp package/700Bold/Inter_700Bold.ttf public/fonts/Inter-Bold.ttf
cp package/700Bold_Italic/Inter_700Bold_Italic.ttf public/fonts/Inter-BoldItalic.ttf
cp package/LICENSE_FONT public/fonts/LICENSE.txt
rm -rf package expo-google-fonts-inter-0.4.2.tgz
```

- [ ] **Step 2: Verify the four files exist and are ~340KB each**

```bash
ls -l public/fonts/
```

Expected: four `.ttf` files, each between 300KB and 400KB, plus `LICENSE.txt`.

- [ ] **Step 3: Commit**

```bash
git add public/fonts
git commit -m "Vendor Inter TTF weights for measurement and PDF embedding"
```

---

## Task 3: Data model types

**Files:**
- Create: `src/model/types.ts`

- [ ] **Step 1: Write the types**

```ts
export type ObjectId = string;
export type PageId = string;
export type Rotation = 0 | 90 | 180 | 270;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page of the working document. Coordinates of its objects are in
 *  UNROTATED page space: origin top-left, y-down, units = PDF points. */
export interface Page {
  id: PageId;
  sourceIndex: number;
  /** User-applied rotation, added to the source page's own /Rotate at export. */
  rotation: Rotation;
  width: number;
  height: number;
  /** Array order is z-order; last element renders in front. */
  objectIds: ObjectId[];
}

export interface BaseObject extends Rect {
  id: ObjectId;
  pageId: PageId;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextObject extends BaseObject {
  kind: 'text';
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** Multiplier applied to fontSize to get the line box height. */
  lineHeight: number;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';

export interface ShapeObject extends BaseObject {
  kind: ShapeKind;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  cornerRadius?: number;
  arrowHeadSize?: number;
}

export type EditorObject = TextObject | ShapeObject;

export interface Doc {
  fileName: string;
  sourceBytes: Uint8Array;
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
}

export const isText = (o: EditorObject): o is TextObject => o.kind === 'text';
export const isShape = (o: EditorObject): o is ShapeObject => o.kind !== 'text';

export type ToolId = 'select' | 'text' | ShapeKind;
```

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/model/types.ts
git commit -m "Add editor data model types"
```

---

## Task 4: Coordinate transforms

**Files:**
- Create: `src/geometry/coords.ts`
- Test: `src/geometry/coords.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  pointsToScreen, screenToPoints, rectToScreen,
  displaySize, displayToPage, rectToPdf,
} from './coords';

describe('scale conversion', () => {
  it('round-trips a value through screen and back', () => {
    expect(screenToPoints(pointsToScreen(100, 1.5), 1.5)).toBeCloseTo(100, 10);
  });

  it('scales a rect', () => {
    expect(rectToScreen({ x: 10, y: 20, width: 30, height: 40 }, 2))
      .toEqual({ x: 20, y: 40, width: 60, height: 80 });
  });
});

describe('displaySize', () => {
  const page = { width: 600, height: 800 };
  it('leaves dimensions alone at 0 and 180', () => {
    expect(displaySize({ ...page, rotation: 0 })).toEqual({ width: 600, height: 800 });
    expect(displaySize({ ...page, rotation: 180 })).toEqual({ width: 600, height: 800 });
  });
  it('swaps dimensions at 90 and 270', () => {
    expect(displaySize({ ...page, rotation: 90 })).toEqual({ width: 800, height: 600 });
    expect(displaySize({ ...page, rotation: 270 })).toEqual({ width: 800, height: 600 });
  });
});

describe('displayToPage', () => {
  const page = { width: 600, height: 800, rotation: 0 as const };

  it('is identity at rotation 0', () => {
    expect(displayToPage({ x: 10, y: 20 }, page)).toEqual({ x: 10, y: 20 });
  });

  it('maps the display top-left to the page bottom-left at 90', () => {
    // Display is 800x600. Display (0,0) corresponds to page (0, 800) — the
    // page's bottom-left corner appears top-left once rotated 90 clockwise.
    const p = { ...page, rotation: 90 as const };
    expect(displayToPage({ x: 0, y: 0 }, p)).toEqual({ x: 0, y: 800 });
    expect(displayToPage({ x: 800, y: 0 }, p)).toEqual({ x: 0, y: 0 });
  });

  it('inverts the corners at 180', () => {
    const p = { ...page, rotation: 180 as const };
    expect(displayToPage({ x: 0, y: 0 }, p)).toEqual({ x: 600, y: 800 });
  });

  it('maps correctly at 270', () => {
    const p = { ...page, rotation: 270 as const };
    expect(displayToPage({ x: 0, y: 0 }, p)).toEqual({ x: 600, y: 0 });
  });
});

describe('rectToPdf', () => {
  it('flips y so the rect is anchored at its bottom-left', () => {
    // A 40-tall box whose top is 100 from the page top, on an 800-tall page,
    // has its bottom edge at 800 - 100 - 40 = 660 in PDF coordinates.
    expect(rectToPdf({ x: 50, y: 100, width: 30, height: 40 }, 800))
      .toEqual({ x: 50, y: 660, width: 30, height: 40 });
  });

  it('round-trips: flipping twice returns the original', () => {
    const r = { x: 5, y: 15, width: 25, height: 35 };
    expect(rectToPdf(rectToPdf(r, 800), 800)).toEqual(r);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/geometry/coords.test.ts
```

Expected: FAIL — cannot resolve `./coords`.

- [ ] **Step 3: Implement**

```ts
import type { Rect, Rotation } from '../model/types';

export interface Point { x: number; y: number }
export interface PageGeometry { width: number; height: number; rotation: Rotation }

export const pointsToScreen = (v: number, scale: number): number => v * scale;
export const screenToPoints = (v: number, scale: number): number => v / scale;

export function rectToScreen(r: Rect, scale: number): Rect {
  return { x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale };
}

export function rectFromScreen(r: Rect, scale: number): Rect {
  return { x: r.x / scale, y: r.y / scale, width: r.width / scale, height: r.height / scale };
}

/** Size of the page as the user sees it, after rotation. */
export function displaySize(page: PageGeometry): { width: number; height: number } {
  return page.rotation === 90 || page.rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/**
 * Convert a point in display space (what the user sees and clicks, origin
 * top-left, y-down) into unrotated page space (origin top-left, y-down).
 *
 * Objects are stored in unrotated page space, so this is applied to pointer
 * input only. Rendering goes the other way via a single CSS rotate() on the
 * page container.
 */
export function displayToPage(p: Point, page: PageGeometry): Point {
  const { width: W, height: H } = page;
  switch (page.rotation) {
    case 0:   return { x: p.x, y: p.y };
    case 90:  return { x: p.y, y: H - p.x };
    case 180: return { x: W - p.x, y: H - p.y };
    case 270: return { x: W - p.y, y: p.x };
  }
}

export function pageToDisplay(p: Point, page: PageGeometry): Point {
  const { width: W, height: H } = page;
  switch (page.rotation) {
    case 0:   return { x: p.x, y: p.y };
    case 90:  return { x: H - p.y, y: p.x };
    case 180: return { x: W - p.x, y: H - p.y };
    case 270: return { x: p.y, y: W - p.x };
  }
}

/**
 * Convert a rect from unrotated page space (top-left origin, y-down) to PDF
 * user space (bottom-left origin, y-up). Only the anchor moves; width and
 * height are unchanged.
 */
export function rectToPdf(r: Rect, pageHeight: number): Rect {
  return { x: r.x, y: pageHeight - r.y - r.height, width: r.width, height: r.height };
}

/** Convert a y coordinate (top-left origin, y-down) to PDF user space. */
export function yToPdf(y: number, pageHeight: number): number {
  return pageHeight - y;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/geometry/coords.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/geometry/coords.ts src/geometry/coords.test.ts
git commit -m "Add coordinate transforms with rotation and y-flip"
```

---

## Task 5: Font metrics and text layout

This is the module that guarantees preview/export agreement. It must sum raw glyph advances — see "Two verified findings" above.

**Files:**
- Create: `src/pdf/fontMetrics.ts`
- Test: `src/pdf/fontMetrics.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMetrics, layoutText, type FontMetrics } from './fontMetrics';

let m: FontMetrics;

beforeAll(() => {
  m = createMetrics(readFileSync('public/fonts/Inter-Regular.ttf'));
});

describe('measureText', () => {
  it('matches pdf-lib by summing raw advances, not kerned advances', () => {
    // Verified against pdf-lib widthOfTextAtSize; the kerned value is 115.8750.
    expect(m.measureText('The quick brown fox', 12)).toBeCloseTo(116.9121, 3);
    expect(m.measureText('AV Wa To', 12)).toBeCloseTo(56.8125, 3);
  });

  it('returns 0 for an empty string', () => {
    expect(m.measureText('', 12)).toBe(0);
  });

  it('scales linearly with font size', () => {
    expect(m.measureText('Hello', 24)).toBeCloseTo(m.measureText('Hello', 12) * 2, 6);
  });
});

describe('layoutText', () => {
  it('keeps text on one line when it fits', () => {
    const r = layoutText(m, 'Hello world', 12, 500, 1.2);
    expect(r.lines.map(l => l.text)).toEqual(['Hello world']);
  });

  it('wraps at word boundaries when it does not fit', () => {
    const r = layoutText(m, 'The quick brown fox', 12, 60, 1.2);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const line of r.lines) expect(line.width).toBeLessThanOrEqual(60);
  });

  it('honours explicit newlines', () => {
    const r = layoutText(m, 'one\ntwo', 12, 500, 1.2);
    expect(r.lines.map(l => l.text)).toEqual(['one', 'two']);
  });

  it('breaks a single unbreakable word that exceeds the width', () => {
    const r = layoutText(m, 'AAAAAAAAAAAAAAAAAAAA', 12, 30, 1.2);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const line of r.lines) expect(line.width).toBeLessThanOrEqual(30);
  });

  it('produces one empty line for empty input so the caret has a home', () => {
    const r = layoutText(m, '', 12, 100, 1.2);
    expect(r.lines).toEqual([{ text: '', width: 0 }]);
    expect(r.height).toBeCloseTo(12 * 1.2, 6);
  });

  it('computes height as line count times line height', () => {
    const r = layoutText(m, 'a\nb\nc', 10, 500, 1.5);
    expect(r.height).toBeCloseTo(3 * 15, 6);
  });

  it('offsets lines for centre and right alignment', () => {
    const r = layoutText(m, 'ab', 12, 200, 1.2);
    const w = r.lines[0].width;
    expect(lineX(r, 0, 'left', 200)).toBeCloseTo(0, 6);
    expect(lineX(r, 0, 'center', 200)).toBeCloseTo((200 - w) / 2, 6);
    expect(lineX(r, 0, 'right', 200)).toBeCloseTo(200 - w, 6);
  });
});

// Imported here to keep the test list above readable.
import { lineX } from './fontMetrics';
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/pdf/fontMetrics.test.ts
```

Expected: FAIL — cannot resolve `./fontMetrics`.

- [ ] **Step 3: Implement**

```ts
import fontkit from '@pdf-lib/fontkit';
import type { TextAlign } from '../model/types';

export interface FontMetrics {
  /** Raw font bytes, reused for pdf-lib embedding and the FontFace API. */
  bytes: Uint8Array;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  /**
   * Width of `text` at `fontSize`, computed as the sum of raw glyph advance
   * widths. This deliberately does NOT use layout().advanceWidth, which
   * applies GPOS kerning that pdf-lib does not reproduce when drawing.
   */
  measureText(text: string, fontSize: number): number;
}

export function createMetrics(bytes: Uint8Array): FontMetrics {
  const font = fontkit.create(bytes as never) as {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    layout(t: string): { glyphs: { advanceWidth: number }[] };
  };

  const cache = new Map<string, number>();

  const advanceUnits = (text: string): number => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const g of font.layout(text).glyphs) total += g.advanceWidth;
    if (cache.size < 5000) cache.set(text, total);
    return total;
  };

  return {
    bytes,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    measureText(text, fontSize) {
      if (text === '') return 0;
      return (advanceUnits(text) / font.unitsPerEm) * fontSize;
    },
  };
}

export interface LaidOutLine {
  text: string;
  width: number;
}

export interface TextLayout {
  lines: LaidOutLine[];
  /** Height of one line box, in points. */
  lineBoxHeight: number;
  /** Distance from a line box's top to its baseline, in points. */
  baselineOffset: number;
  /** Total height of the laid-out text, in points. */
  height: number;
}

/**
 * Break `text` into lines that fit within `maxWidth`.
 *
 * This is the single source of truth for line breaking. Both the DOM renderer
 * and the PDF exporter consume its output, so the browser is never permitted
 * to make a wrapping decision of its own.
 */
export function layoutText(
  m: FontMetrics,
  text: string,
  fontSize: number,
  maxWidth: number,
  lineHeightMultiplier: number,
): TextLayout {
  const lineBoxHeight = fontSize * lineHeightMultiplier;
  const asc = (m.ascent / m.unitsPerEm) * fontSize;
  const desc = (m.descent / m.unitsPerEm) * fontSize; // negative
  const halfLeading = (lineBoxHeight - (asc - desc)) / 2;

  const lines: LaidOutLine[] = [];
  const push = (t: string) => lines.push({ text: t, width: m.measureText(t, fontSize) });

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      push('');
      continue;
    }
    // Keep trailing spaces attached to their word so widths stay faithful.
    const words = paragraph.match(/\S+\s*/g) ?? [];
    let current = '';

    for (const word of words) {
      const candidate = current + word;
      if (m.measureText(candidate.trimEnd(), fontSize) <= maxWidth || current === '') {
        current = candidate;
      } else {
        push(current.trimEnd());
        current = word;
      }
      // A single word wider than the box must be broken mid-word, otherwise
      // it would overflow the text box silently.
      while (m.measureText(current.trimEnd(), fontSize) > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && m.measureText(current.slice(0, cut), fontSize) > maxWidth) cut--;
        push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    push(current.trimEnd());
  }

  if (lines.length === 0) push('');

  return {
    lines,
    lineBoxHeight,
    baselineOffset: halfLeading + asc,
    height: lines.length * lineBoxHeight,
  };
}

/** Horizontal offset of line `i` within a box of `boxWidth`, given alignment. */
export function lineX(layout: TextLayout, i: number, align: TextAlign, boxWidth: number): number {
  const w = layout.lines[i].width;
  if (align === 'center') return (boxWidth - w) / 2;
  if (align === 'right') return boxWidth - w;
  return 0;
}

// ─── Browser-side lazy loading ────────────────────────────────────────────

export type FontVariant = 'regular' | 'italic' | 'bold' | 'boldItalic';

export const variantOf = (bold: boolean, italic: boolean): FontVariant =>
  bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';

const FILES: Record<FontVariant, string> = {
  regular: '/fonts/Inter-Regular.ttf',
  italic: '/fonts/Inter-Italic.ttf',
  bold: '/fonts/Inter-Bold.ttf',
  boldItalic: '/fonts/Inter-BoldItalic.ttf',
};

const CSS_FAMILY: Record<FontVariant, string> = {
  regular: 'InterPdf',
  italic: 'InterPdf',
  bold: 'InterPdf',
  boldItalic: 'InterPdf',
};

const loaded = new Map<FontVariant, Promise<FontMetrics>>();

/**
 * Fetch a variant's TTF once and use it for three things at once: fontkit
 * measurement, the DOM @font-face, and pdf-lib embedding. One download, and
 * the browser renders from the exact file the export embeds.
 */
export function loadFont(variant: FontVariant): Promise<FontMetrics> {
  const existing = loaded.get(variant);
  if (existing) return existing;

  const p = fetch(FILES[variant])
    .then(async (res) => {
      if (!res.ok) throw new Error(`Failed to load font ${variant}: ${res.status}`);
      const buf = await res.arrayBuffer();
      if (typeof FontFace !== 'undefined') {
        const face = new FontFace(CSS_FAMILY[variant], buf, {
          weight: variant === 'bold' || variant === 'boldItalic' ? '700' : '400',
          style: variant === 'italic' || variant === 'boldItalic' ? 'italic' : 'normal',
        });
        await face.load();
        document.fonts.add(face);
      }
      return createMetrics(new Uint8Array(buf));
    });

  loaded.set(variant, p);
  return p;
}

/** Synchronous accessor for already-loaded variants, for render paths. */
const ready = new Map<FontVariant, FontMetrics>();
export function primeFont(variant: FontVariant): Promise<FontMetrics> {
  return loadFont(variant).then((m) => {
    ready.set(variant, m);
    return m;
  });
}
export const getLoadedFont = (variant: FontVariant): FontMetrics | undefined => ready.get(variant);
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/pdf/fontMetrics.test.ts
```

Expected: PASS, 11 tests. The first test is the guard against kerning drift — if it fails, `measureText` has been changed to use `layout().advanceWidth`.

- [ ] **Step 5: Commit**

```bash
git add src/pdf/fontMetrics.ts src/pdf/fontMetrics.test.ts
git commit -m "Add Inter font metrics and shared text layout"
```

---

## Task 6: Snapping

**Files:**
- Create: `src/geometry/snapping.ts`
- Test: `src/geometry/snapping.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { resolveSnap, type SnapTarget } from './snapping';
import type { Rect } from '../model/types';

const page = { width: 600, height: 800 };
const opts = { threshold: 6, page };
const targets = (...rects: { id: string; rect: Rect }[]): SnapTarget[] => rects;

describe('object snapping', () => {
  const other = targets({ id: 'a', rect: { x: 100, y: 100, width: 50, height: 50 } });

  it('snaps a left edge to another object left edge', () => {
    const moving: Rect = { x: 103, y: 300, width: 40, height: 40 };
    const r = resolveSnap(moving, other, opts);
    expect(r.rect.x).toBe(100);
    expect(r.indicators.some(i => i.kind === 'object' && i.id === 'a')).toBe(true);
  });

  it('does not snap beyond the threshold', () => {
    const moving: Rect = { x: 120, y: 300, width: 40, height: 40 };
    expect(resolveSnap(moving, other, opts).rect.x).toBe(120);
  });

  it('snaps the two axes independently to different objects', () => {
    const two = targets(
      { id: 'a', rect: { x: 100, y: 500, width: 50, height: 50 } },
      { id: 'b', rect: { x: 400, y: 200, width: 50, height: 50 } },
    );
    const moving: Rect = { x: 102, y: 203, width: 40, height: 40 };
    const r = resolveSnap(moving, two, opts);
    expect(r.rect.x).toBe(100); // from a
    expect(r.rect.y).toBe(200); // from b
  });

  it('prefers the nearest candidate when several are in range', () => {
    const two = targets(
      { id: 'a', rect: { x: 100, y: 300, width: 50, height: 50 } },
      { id: 'b', rect: { x: 104, y: 300, width: 50, height: 50 } },
    );
    const moving: Rect = { x: 103, y: 600, width: 40, height: 40 };
    expect(resolveSnap(moving, two, opts).rect.x).toBe(104);
  });

  it('snaps centre to centre', () => {
    const other2 = targets({ id: 'a', rect: { x: 100, y: 100, width: 100, height: 50 } });
    // other centre-x = 150. moving width 40, so x = 130 centres it.
    const moving: Rect = { x: 128, y: 400, width: 40, height: 40 };
    expect(resolveSnap(moving, other2, opts).rect.x).toBe(130);
  });
});

describe('page guides', () => {
  it('snaps to the page horizontal centre', () => {
    // page centre-x = 300; a 40-wide box centres at x = 280.
    const moving: Rect = { x: 283, y: 400, width: 40, height: 40 };
    const r = resolveSnap(moving, [], opts);
    expect(r.rect.x).toBe(280);
    expect(r.indicators.some(i => i.kind === 'page')).toBe(true);
  });

  it('snaps to the page left edge', () => {
    const moving: Rect = { x: 3, y: 400, width: 40, height: 40 };
    expect(resolveSnap(moving, [], opts).rect.x).toBe(0);
  });
});

describe('equal spacing', () => {
  it('continues an evenly spaced run', () => {
    // Three 20-wide boxes at x = 0, 50, 100 → gap of 30. A fourth continues
    // the run at x = 150.
    const run = targets(
      { id: 'a', rect: { x: 0, y: 100, width: 20, height: 20 } },
      { id: 'b', rect: { x: 50, y: 100, width: 20, height: 20 } },
      { id: 'c', rect: { x: 100, y: 100, width: 20, height: 20 } },
    );
    const moving: Rect = { x: 152, y: 100, width: 20, height: 20 };
    const r = resolveSnap(moving, run, opts);
    expect(r.rect.x).toBe(150);
    expect(r.indicators.some(i => i.kind === 'spacing')).toBe(true);
  });
});

describe('suppression', () => {
  it('returns the rect untouched when disabled', () => {
    const other = targets({ id: 'a', rect: { x: 100, y: 100, width: 50, height: 50 } });
    const moving: Rect = { x: 103, y: 103, width: 40, height: 40 };
    const r = resolveSnap(moving, other, { ...opts, enabled: false });
    expect(r.rect).toEqual(moving);
    expect(r.indicators).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/geometry/snapping.test.ts
```

Expected: FAIL — cannot resolve `./snapping`.

- [ ] **Step 3: Implement**

```ts
import type { Rect } from '../model/types';

export interface SnapTarget {
  id: string;
  rect: Rect;
}

export type SnapIndicator =
  | { kind: 'object'; id: string; rect: Rect }
  | { kind: 'page'; axis: 'x' | 'y'; position: number }
  | { kind: 'spacing'; axis: 'x' | 'y'; gaps: Rect[] };

export interface SnapOptions {
  threshold: number;
  page: { width: number; height: number };
  /** False while Alt is held, to let the user place freely. */
  enabled?: boolean;
}

export interface SnapResult {
  rect: Rect;
  indicators: SnapIndicator[];
}

interface Candidate {
  /** Where the moving edge should land. */
  position: number;
  /** Which of the moving rect's own edges this applies to: 0=start, 0.5=centre, 1=end. */
  anchor: 0 | 0.5 | 1;
  indicator: SnapIndicator;
}

const edgesOf = (r: Rect, axis: 'x' | 'y') =>
  axis === 'x'
    ? { start: r.x, centre: r.x + r.width / 2, end: r.x + r.width }
    : { start: r.y, centre: r.y + r.height / 2, end: r.y + r.height };

const sizeOf = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? r.width : r.height);

function candidatesFor(
  axis: 'x' | 'y',
  targets: SnapTarget[],
  page: { width: number; height: number },
): Candidate[] {
  const out: Candidate[] = [];

  for (const t of targets) {
    const e = edgesOf(t.rect, axis);
    const ind: SnapIndicator = { kind: 'object', id: t.id, rect: t.rect };
    for (const pos of [e.start, e.centre, e.end]) {
      out.push({ position: pos, anchor: 0, indicator: ind });
      out.push({ position: pos, anchor: 0.5, indicator: ind });
      out.push({ position: pos, anchor: 1, indicator: ind });
    }
  }

  const extent = axis === 'x' ? page.width : page.height;
  for (const pos of [0, extent / 2, extent]) {
    const ind: SnapIndicator = { kind: 'page', axis, position: pos };
    out.push({ position: pos, anchor: 0, indicator: ind });
    out.push({ position: pos, anchor: 0.5, indicator: ind });
    out.push({ position: pos, anchor: 1, indicator: ind });
  }

  return out;
}

/**
 * Find runs of three or more targets evenly spaced along `axis` and aligned on
 * the perpendicular axis, and offer the position that continues the run.
 */
function spacingCandidates(
  axis: 'x' | 'y',
  moving: Rect,
  targets: SnapTarget[],
): Candidate[] {
  const perp = axis === 'x' ? 'y' : 'x';
  const movingPerp = edgesOf(moving, perp);

  // Only consider targets roughly in line with the moving object.
  const inLine = targets.filter((t) => {
    const e = edgesOf(t.rect, perp);
    return Math.abs(e.centre - movingPerp.centre) < 1;
  });
  if (inLine.length < 2) return [];

  const sorted = [...inLine].sort((a, b) => edgesOf(a.rect, axis).start - edgesOf(b.rect, axis).start);

  const out: Candidate[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const gaps: number[] = [];
    for (let j = i; j + 1 < sorted.length; j++) {
      gaps.push(edgesOf(sorted[j + 1].rect, axis).start - edgesOf(sorted[j].rect, axis).end);
    }
    if (gaps.length < 2) continue;
    const g = gaps[0];
    if (g < 0 || !gaps.every((x) => Math.abs(x - g) < 0.5)) continue;

    const last = sorted[sorted.length - 1];
    const gapRects: Rect[] = sorted.slice(0, -1).map((t, k) => {
      const a = edgesOf(t.rect, axis).end;
      return axis === 'x'
        ? { x: a, y: moving.y, width: g, height: moving.height }
        : { x: moving.x, y: a, width: moving.width, height: g };
    });

    const next = edgesOf(last.rect, axis).end + g;
    out.push({
      position: next,
      anchor: 0,
      indicator: {
        kind: 'spacing',
        axis,
        gaps: [
          ...gapRects,
          axis === 'x'
            ? { x: edgesOf(last.rect, axis).end, y: moving.y, width: g, height: moving.height }
            : { x: moving.x, y: edgesOf(last.rect, axis).end, width: moving.width, height: g },
        ],
      },
    });
    break;
  }
  return out;
}

function bestForAxis(
  axis: 'x' | 'y',
  moving: Rect,
  targets: SnapTarget[],
  opts: SnapOptions,
): { offset: number; indicator: SnapIndicator } | null {
  const size = sizeOf(moving, axis);
  const e = edgesOf(moving, axis);
  const own = { 0: e.start, 0.5: e.centre, 1: e.end } as Record<number, number>;

  const all = [
    ...candidatesFor(axis, targets, opts.page),
    ...spacingCandidates(axis, moving, targets),
  ];

  let best: { offset: number; distance: number; indicator: SnapIndicator } | null = null;

  for (const c of all) {
    const current = own[c.anchor];
    const distance = Math.abs(c.position - current);
    if (distance > opts.threshold) continue;
    const offset = c.position - current;
    if (!best || distance < best.distance) best = { offset, distance, indicator: c.indicator };
  }

  void size;
  return best ? { offset: best.offset, indicator: best.indicator } : null;
}

export function resolveSnap(moving: Rect, targets: SnapTarget[], opts: SnapOptions): SnapResult {
  if (opts.enabled === false) return { rect: moving, indicators: [] };

  const x = bestForAxis('x', moving, targets, opts);
  const y = bestForAxis('y', moving, targets, opts);

  const indicators: SnapIndicator[] = [];
  if (x) indicators.push(x.indicator);
  if (y) indicators.push(y.indicator);

  return {
    rect: {
      x: moving.x + (x?.offset ?? 0),
      y: moving.y + (y?.offset ?? 0),
      width: moving.width,
      height: moving.height,
    },
    indicators,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/geometry/snapping.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/geometry/snapping.ts src/geometry/snapping.test.ts
git commit -m "Add object, page-guide and equal-spacing snapping"
```

---

## Task 7: Undo/redo history

**Files:**
- Create: `src/model/history.ts`
- Test: `src/model/history.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
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
    while (h.canUndo()) { h.undo(); steps++; }
    expect(steps).toBe(3);
  });

  it('returns null when there is nothing to undo', () => {
    expect(createHistory({ n: 0 }).undo()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/model/history.test.ts
```

Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Implement**

```ts
export interface History<T> {
  push(state: T): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  reset(state: T): void;
}

/**
 * Snapshot-based undo. The document is small (objects are plain data and the
 * source PDF bytes are shared by reference, not copied), so snapshots are
 * cheaper and far less bug-prone than inverse-operation tracking.
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
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/model/history.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/model/history.ts src/model/history.test.ts
git commit -m "Add snapshot-based undo/redo history"
```

---

## Task 8: Zustand store

**Files:**
- Create: `src/model/store.ts`

- [ ] **Step 1: Implement the store**

```ts
import { create } from 'zustand';
import { createHistory } from './history';
import type {
  Doc, EditorObject, ObjectId, PageId, Rotation, ToolId, Page,
} from './types';

let idCounter = 0;
export const nextId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${idCounter++}`;

/** The slice of state that undo/redo restores. */
interface Snapshot {
  pages: Page[];
  objects: Record<ObjectId, EditorObject>;
}

interface State {
  doc: Doc | null;
  activePageId: PageId | null;
  tool: ToolId;
  selection: ObjectId[];
  zoom: number;
  snapEnabled: boolean;
  error: string | null;

  loadDoc(doc: Doc): void;
  closeDoc(): void;
  setTool(t: ToolId): void;
  setActivePage(id: PageId): void;
  setZoom(z: number): void;
  setSnapEnabled(on: boolean): void;
  setError(message: string | null): void;

  select(ids: ObjectId[]): void;
  addToSelection(id: ObjectId): void;
  clearSelection(): void;

  addObject(o: EditorObject): void;
  updateObject(id: ObjectId, patch: Partial<EditorObject>): void;
  /** Live drag updates; not pushed to history until commitInteraction(). */
  updateObjectTransient(id: ObjectId, patch: Partial<EditorObject>): void;
  commitInteraction(): void;
  deleteObjects(ids: ObjectId[]): void;
  bringToFront(id: ObjectId): void;
  sendToBack(id: ObjectId): void;

  reorderPages(from: number, to: number): void;
  deletePage(id: PageId): void;
  rotatePage(id: PageId, delta: 90 | -90): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

const history = createHistory<Snapshot>({ pages: [], objects: {} });

const snapshot = (doc: Doc): Snapshot => ({
  pages: doc.pages.map((p) => ({ ...p, objectIds: [...p.objectIds] })),
  objects: Object.fromEntries(Object.entries(doc.objects).map(([k, v]) => [k, { ...v }])),
});

export const useStore = create<State>((set, get) => {
  /** Apply a mutation and record it in history. */
  const mutate = (fn: (doc: Doc) => void) => {
    const { doc } = get();
    if (!doc) return;
    const next: Doc = { ...doc, pages: [...doc.pages], objects: { ...doc.objects } };
    fn(next);
    history.push(snapshot(next));
    set({ doc: next });
  };

  /** Apply a mutation WITHOUT recording history — for live drag frames. */
  const mutateTransient = (fn: (doc: Doc) => void) => {
    const { doc } = get();
    if (!doc) return;
    const next: Doc = { ...doc, pages: [...doc.pages], objects: { ...doc.objects } };
    fn(next);
    set({ doc: next });
  };

  const restore = (s: Snapshot | null) => {
    const { doc } = get();
    if (!doc || !s) return;
    set({
      doc: { ...doc, pages: s.pages, objects: s.objects },
      selection: get().selection.filter((id) => id in s.objects),
    });
  };

  return {
    doc: null,
    activePageId: null,
    tool: 'select',
    selection: [],
    zoom: 1,
    snapEnabled: true,
    error: null,

    loadDoc(doc) {
      history.reset(snapshot(doc));
      set({ doc, activePageId: doc.pages[0]?.id ?? null, selection: [], error: null, zoom: 1 });
    },
    closeDoc() {
      history.reset({ pages: [], objects: {} });
      set({ doc: null, activePageId: null, selection: [], error: null });
    },
    setTool: (tool) => set({ tool }),
    setActivePage: (activePageId) => set({ activePageId, selection: [] }),
    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, zoom)) }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
    setError: (error) => set({ error }),

    select: (selection) => set({ selection }),
    addToSelection: (id) =>
      set((s) => (s.selection.includes(id) ? s : { selection: [...s.selection, id] })),
    clearSelection: () => set({ selection: [] }),

    addObject(o) {
      mutate((doc) => {
        doc.objects[o.id] = o;
        const page = doc.pages.find((p) => p.id === o.pageId);
        if (page) page.objectIds = [...page.objectIds, o.id];
      });
      set({ selection: [o.id] });
    },

    updateObject(id, patch) {
      mutate((doc) => {
        const existing = doc.objects[id];
        if (existing) doc.objects[id] = { ...existing, ...patch } as EditorObject;
      });
    },

    updateObjectTransient(id, patch) {
      mutateTransient((doc) => {
        const existing = doc.objects[id];
        if (existing) doc.objects[id] = { ...existing, ...patch } as EditorObject;
      });
    },

    commitInteraction() {
      const { doc } = get();
      if (doc) history.push(snapshot(doc));
    },

    deleteObjects(ids) {
      mutate((doc) => {
        for (const id of ids) {
          const o = doc.objects[id];
          if (!o) continue;
          delete doc.objects[id];
          const page = doc.pages.find((p) => p.id === o.pageId);
          if (page) page.objectIds = page.objectIds.filter((x) => x !== id);
        }
      });
      set({ selection: [] });
    },

    bringToFront(id) {
      mutate((doc) => {
        const o = doc.objects[id];
        const page = o && doc.pages.find((p) => p.id === o.pageId);
        if (page) page.objectIds = [...page.objectIds.filter((x) => x !== id), id];
      });
    },

    sendToBack(id) {
      mutate((doc) => {
        const o = doc.objects[id];
        const page = o && doc.pages.find((p) => p.id === o.pageId);
        if (page) page.objectIds = [id, ...page.objectIds.filter((x) => x !== id)];
      });
    },

    reorderPages(from, to) {
      mutate((doc) => {
        const pages = [...doc.pages];
        const [moved] = pages.splice(from, 1);
        pages.splice(to, 0, moved);
        doc.pages = pages;
      });
    },

    deletePage(id) {
      const { doc, activePageId } = get();
      if (!doc || doc.pages.length <= 1) return;
      const index = doc.pages.findIndex((p) => p.id === id);
      mutate((d) => {
        const page = d.pages.find((p) => p.id === id);
        if (page) for (const oid of page.objectIds) delete d.objects[oid];
        d.pages = d.pages.filter((p) => p.id !== id);
      });
      if (activePageId === id) {
        const pages = get().doc?.pages ?? [];
        set({ activePageId: pages[Math.min(index, pages.length - 1)]?.id ?? null, selection: [] });
      }
    },

    rotatePage(id, delta) {
      mutate((doc) => {
        const page = doc.pages.find((p) => p.id === id);
        if (page) page.rotation = (((page.rotation + delta) % 360) + 360) % 360 as Rotation;
      });
    },

    undo() { restore(history.undo()); },
    redo() { restore(history.redo()); },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
  };
});
```

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/model/store.ts
git commit -m "Add Zustand editor store with history integration"
```

---

## Task 9: Load a PDF document

**Files:**
- Create: `src/pdf/loadDocument.ts`

- [ ] **Step 1: Implement**

```ts
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { nextId } from '../model/store';
import type { Doc, Page, Rotation } from '../model/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfLoadError extends Error {}

export interface LoadedPdf {
  doc: Doc;
  proxy: PDFDocumentProxy;
}

export async function loadDocument(file: File): Promise<LoadedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  let proxy: PDFDocumentProxy;
  try {
    // pdf.js transfers the buffer it is given, so hand it a copy and keep ours
    // intact for pdf-lib at export time.
    proxy = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new PdfLoadError('This PDF is password-protected. Encrypted PDFs are not supported.');
    }
    throw new PdfLoadError('This file could not be opened as a PDF.');
  }

  const pages: Page[] = [];
  for (let i = 1; i <= proxy.numPages; i++) {
    const p = await proxy.getPage(i);
    // getViewport at scale 1 already accounts for the source /Rotate, so the
    // width/height we store are the dimensions the user will see at rotation 0.
    const vp = p.getViewport({ scale: 1 });
    pages.push({
      id: nextId('page'),
      sourceIndex: i - 1,
      rotation: 0 as Rotation,
      width: vp.width,
      height: vp.height,
      objectIds: [],
    });
  }

  return {
    doc: { fileName: file.name, sourceBytes: bytes, pages, objects: {} },
    proxy,
  };
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pdf/loadDocument.ts
git commit -m "Add PDF loading with encryption and corruption handling"
```

---

## Task 10: Render a page to canvas

**Files:**
- Create: `src/pdf/renderPage.ts`

- [ ] **Step 1: Implement**

```ts
import type { PDFDocumentProxy } from 'pdfjs-dist';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const key = (sourceIndex: number, scale: number) => `${sourceIndex}@${scale.toFixed(2)}`;

/**
 * Render a source page to a PNG data URL at the given scale.
 *
 * Results are cached by (page, scale) because thumbnails and the main canvas
 * re-request the same page constantly during editing, and rasterising is by
 * far the most expensive thing the app does.
 */
export function renderPage(
  proxy: PDFDocumentProxy,
  sourceIndex: number,
  scale: number,
): Promise<string> {
  const k = key(sourceIndex, scale);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(k);
  if (pending) return pending;

  const job = (async () => {
    const page = await proxy.getPage(sourceIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire a 2D canvas context');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const url = canvas.toDataURL('image/png');
    if (cache.size > 40) cache.clear();
    cache.set(k, url);
    inflight.delete(k);
    return url;
  })();

  inflight.set(k, job);
  return job;
}

export function clearRenderCache(): void {
  cache.clear();
  inflight.clear();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pdf/renderPage.ts
git commit -m "Add cached page rasterisation"
```

---

## Task 11: PDF export

**Files:**
- Create: `src/pdf/exportPdf.ts`
- Test: `src/pdf/exportPdf.test.ts`

- [ ] **Step 1: Write the failing tests**

Create the fixture first:

```bash
mkdir -p src/pdf/__fixtures__
node -e "
const { PDFDocument, rgb } = require('pdf-lib');
(async () => {
  const d = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const p = d.addPage([600, 800]);
    p.drawText('PAGE' + (i + 1), { x: 50, y: 700, size: 24, color: rgb(0,0,0) });
  }
  require('fs').writeFileSync('src/pdf/__fixtures__/three-pages.pdf', await d.save());
})();
"
```

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { exportPdf } from './exportPdf';
import { createMetrics } from './fontMetrics';
import type { Doc, Page, TextObject, ShapeObject } from '../model/types';

let source: Uint8Array;

const page = (id: string, sourceIndex: number, objectIds: string[] = []): Page => ({
  id, sourceIndex, rotation: 0, width: 600, height: 800, objectIds,
});

const baseDoc = (pages: Page[], objects: Doc['objects'] = {}): Doc => ({
  fileName: 'test.pdf', sourceBytes: source, pages, objects,
});

beforeAll(() => {
  source = new Uint8Array(readFileSync('src/pdf/__fixtures__/three-pages.pdf'));
});

const fonts = () => ({
  regular: createMetrics(readFileSync('public/fonts/Inter-Regular.ttf')),
  bold: createMetrics(readFileSync('public/fonts/Inter-Bold.ttf')),
  italic: createMetrics(readFileSync('public/fonts/Inter-Italic.ttf')),
  boldItalic: createMetrics(readFileSync('public/fonts/Inter-BoldItalic.ttf')),
});

describe('page operations', () => {
  it('keeps all pages when nothing changed', async () => {
    const out = await exportPdf(baseDoc([page('a', 0), page('b', 1), page('c', 2)]), fonts());
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it('drops deleted pages', async () => {
    const out = await exportPdf(baseDoc([page('a', 0), page('c', 2)]), fonts());
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('applies user rotation to the exported page', async () => {
    const p = { ...page('a', 0), rotation: 90 as const };
    const out = await exportPdf(baseDoc([p]), fonts());
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPage(0).getRotation().angle).toBe(90);
  });
});

describe('object drawing', () => {
  it('draws a text object without throwing and grows the file', async () => {
    const text: TextObject = {
      id: 't1', pageId: 'a', kind: 'text',
      x: 50, y: 100, width: 200, height: 40,
      text: 'Hello world', fontSize: 14, color: '#ff0000',
      bold: false, italic: false, align: 'left', lineHeight: 1.2,
    };
    const bare = await exportPdf(baseDoc([page('a', 0)]), fonts());
    const withText = await exportPdf(
      baseDoc([page('a', 0, ['t1'])], { t1: text }), fonts(),
    );
    expect(withText.byteLength).toBeGreaterThan(bare.byteLength);
  });

  it('draws every shape kind without throwing', async () => {
    const kinds = ['rect', 'ellipse', 'triangle', 'line', 'arrow'] as const;
    const objects: Doc['objects'] = {};
    const ids: string[] = [];
    kinds.forEach((kind, i) => {
      const id = `s${i}`;
      ids.push(id);
      const shape: ShapeObject = {
        id, pageId: 'a', kind,
        x: 20 + i * 40, y: 200, width: 30, height: 30,
        fill: '#00ff00', fillOpacity: 0.5,
        stroke: '#000000', strokeWidth: 2, strokeOpacity: 1,
        cornerRadius: 4, arrowHeadSize: 8,
      };
      objects[id] = shape;
    });
    const out = await exportPdf(baseDoc([page('a', 0, ids)], objects), fonts());
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/pdf/exportPdf.test.ts
```

Expected: FAIL — cannot resolve `./exportPdf`.

- [ ] **Step 3: Implement**

```ts
import {
  PDFDocument, rgb, degrees, pushGraphicsState, popGraphicsState,
  type PDFFont, type PDFPage, type RGB,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { layoutText, lineX, variantOf, type FontMetrics, type FontVariant } from './fontMetrics';
import { rectToPdf } from '../geometry/coords';
import type { Doc, ShapeObject, TextObject } from '../model/types';
import { isText } from '../model/types';

export type FontSet = Record<FontVariant, FontMetrics>;

/** Convert "#rrggbb" to a pdf-lib RGB. */
export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawTextObject(
  page: PDFPage,
  o: TextObject,
  metrics: FontMetrics,
  font: PDFFont,
  pageHeight: number,
): void {
  const layout = layoutText(metrics, o.text, o.fontSize, o.width, o.lineHeight);
  const color = hexToRgb(o.color);

  layout.lines.forEach((line, i) => {
    if (line.text === '') return;
    const xOffset = lineX(layout, i, o.align, o.width);
    // Baseline measured from the top of the text box, then flipped into PDF
    // user space where y grows upward.
    const baselineFromTop = i * layout.lineBoxHeight + layout.baselineOffset;
    page.drawText(line.text, {
      x: o.x + xOffset,
      y: pageHeight - (o.y + baselineFromTop),
      size: o.fontSize,
      font,
      color,
    });
  });
}

function drawShapeObject(page: PDFPage, o: ShapeObject, pageHeight: number): void {
  const r = rectToPdf(o, pageHeight);
  const fill = hexToRgb(o.fill);
  const stroke = hexToRgb(o.stroke);
  const common = {
    color: fill,
    opacity: o.fillOpacity,
    borderColor: stroke,
    borderWidth: o.strokeWidth,
    borderOpacity: o.strokeOpacity,
  };

  switch (o.kind) {
    case 'rect':
      page.drawRectangle({ ...common, x: r.x, y: r.y, width: r.width, height: r.height });
      return;

    case 'ellipse':
      page.drawEllipse({
        ...common,
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        xScale: r.width / 2,
        yScale: r.height / 2,
      });
      return;

    case 'triangle': {
      // SVG paths use a y-down coordinate system with the origin at the point
      // given by x/y, so the path is written relative to the box's TOP-left.
      const d = `M ${o.width / 2} 0 L ${o.width} ${o.height} L 0 ${o.height} Z`;
      page.drawSvgPath(d, {
        x: r.x,
        y: r.y + r.height,
        color: fill,
        opacity: o.fillOpacity,
        borderColor: stroke,
        borderWidth: o.strokeWidth,
        borderOpacity: o.strokeOpacity,
      });
      return;
    }

    case 'line':
      page.drawLine({
        start: { x: r.x, y: r.y + r.height },
        end: { x: r.x + r.width, y: r.y },
        color: stroke,
        thickness: o.strokeWidth,
        opacity: o.strokeOpacity,
      });
      return;

    case 'arrow': {
      const head = o.arrowHeadSize ?? Math.max(6, o.strokeWidth * 3);
      const sx = r.x;
      const sy = r.y + r.height;
      const ex = r.x + r.width;
      const ey = r.y;
      const angle = Math.atan2(ey - sy, ex - sx);
      // Stop the shaft at the base of the head so the stroke does not poke
      // through the tip at large stroke widths.
      const bx = ex - Math.cos(angle) * head;
      const by = ey - Math.sin(angle) * head;

      page.drawLine({
        start: { x: sx, y: sy },
        end: { x: bx, y: by },
        color: stroke,
        thickness: o.strokeWidth,
        opacity: o.strokeOpacity,
      });

      const spread = Math.PI / 7;
      const p1 = { x: ex - Math.cos(angle - spread) * head, y: ey - Math.sin(angle - spread) * head };
      const p2 = { x: ex - Math.cos(angle + spread) * head, y: ey - Math.sin(angle + spread) * head };
      const d = `M ${ex} ${-ey} L ${p1.x} ${-p1.y} L ${p2.x} ${-p2.y} Z`;
      page.drawSvgPath(d, { x: 0, y: 0, color: stroke, opacity: o.strokeOpacity, borderWidth: 0 });
      return;
    }
  }
}

/**
 * Build the exported PDF: copy the surviving source pages in the user's order,
 * apply rotation, then draw each page's objects back-to-front.
 */
export async function exportPdf(doc: Doc, fonts: FontSet): Promise<Uint8Array> {
  const source = await PDFDocument.load(doc.sourceBytes, { ignoreEncryption: false });
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);

  // Embed only the variants actually used, and only once each.
  const used = new Set<FontVariant>();
  for (const o of Object.values(doc.objects)) {
    if (isText(o)) used.add(variantOf(o.bold, o.italic));
  }
  const embedded = {} as Record<FontVariant, PDFFont>;
  for (const v of used) {
    embedded[v] = await out.embedFont(fonts[v].bytes, { subset: true });
  }

  const copied = await out.copyPages(source, doc.pages.map((p) => p.sourceIndex));

  for (let i = 0; i < doc.pages.length; i++) {
    const modelPage = doc.pages[i];
    const pdfPage = out.addPage(copied[i]);

    if (modelPage.rotation !== 0) {
      const base = pdfPage.getRotation().angle;
      pdfPage.setRotation(degrees((base + modelPage.rotation) % 360));
    }

    // Objects are stored in unrotated page space, so drawing needs no rotation
    // handling — the viewer applies /Rotate to the finished page.
    const height = modelPage.height;

    pdfPage.pushOperators(pushGraphicsState());
    for (const id of modelPage.objectIds) {
      const o = doc.objects[id];
      if (!o) continue;
      if (isText(o)) {
        const variant = variantOf(o.bold, o.italic);
        const font = embedded[variant];
        if (font) drawTextObject(pdfPage, o, fonts[variant], font, height);
      } else {
        drawShapeObject(pdfPage, o, height);
      }
    }
    pdfPage.pushOperators(popGraphicsState());
  }

  return out.save();
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/pdf/exportPdf.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pdf/exportPdf.ts src/pdf/exportPdf.test.ts src/pdf/__fixtures__
git commit -m "Add PDF export with page ordering, rotation and object drawing"
```

---

## Task 12: App shell and drop zone

**Files:**
- Create: `src/components/DropZone.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`

- [ ] **Step 1: Implement the drop zone**

`src/components/DropZone.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';

interface Props {
  onFile(file: File): void;
  error: string | null;
}

export function DropZone({ onFile, error }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div className="flex h-full items-center justify-center bg-panel p-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-16 text-center transition-colors ${
          over ? 'border-accent bg-blue-50' : 'border-edge bg-surface hover:border-accent'
        }`}
      >
        <div className="text-lg font-semibold">Drop a PDF here</div>
        <div className="text-sm text-slate-500">or click to choose a file</div>
        <div className="text-xs text-slate-400">Everything stays on your device</div>
        {error && <div className="mt-4 text-sm font-medium text-red-600">{error}</div>}
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => handle(e.target.files)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire up `App.tsx`**

```tsx
import { useCallback, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useStore } from './model/store';
import { loadDocument, PdfLoadError } from './pdf/loadDocument';
import { primeFont } from './pdf/fontMetrics';
import { DropZone } from './components/DropZone';

export default function App() {
  const doc = useStore((s) => s.doc);
  const error = useStore((s) => s.error);
  const loadDoc = useStore((s) => s.loadDoc);
  const setError = useStore((s) => s.setError);
  const proxy = useRef<PDFDocumentProxy | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadDocument(file);
      proxy.current = loaded.proxy;
      loadDoc(loaded.doc);
      void primeFont('regular');
    } catch (e) {
      setError(e instanceof PdfLoadError ? e.message : 'Something went wrong opening that file.');
    } finally {
      setBusy(false);
    }
  }, [loadDoc, setError]);

  if (!doc) {
    return busy
      ? <div className="flex h-full items-center justify-center text-slate-500">Opening…</div>
      : <DropZone onFile={onFile} error={error} />;
  }

  return <div className="h-full">Editor goes here — {doc.pages.length} pages</div>;
}
```

- [ ] **Step 3: Verify in the browser**

```bash
npm run dev
```

Expected: the drop zone renders. Dropping a real PDF replaces it with "Editor goes here — N pages". Dropping a `.txt` shows the error message.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/DropZone.tsx
git commit -m "Add drop zone and document loading flow"
```

---

## Task 13: Page canvas with rotation

**Files:**
- Create: `src/components/PageCanvas.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '../pdf/renderPage';
import { displaySize } from '../geometry/coords';
import type { Page } from '../model/types';

interface Props {
  proxy: PDFDocumentProxy;
  page: Page;
  zoom: number;
  children?: React.ReactNode;
}

/**
 * Renders one page. The page's rotation is applied as a single CSS transform
 * around the whole container, so the object layer inside can work purely in
 * unrotated page coordinates.
 */
export function PageCanvas({ proxy, page, zoom, children }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    renderPage(proxy, page.sourceIndex, Math.min(zoom * 2, 3))
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [proxy, page.sourceIndex, zoom]);

  const display = displaySize(page);
  const outerW = display.width * zoom;
  const outerH = display.height * zoom;

  return (
    <div className="relative shadow-lg" style={{ width: outerW, height: outerH }}>
      <div
        className="absolute left-0 top-0 origin-top-left bg-white"
        style={{
          width: page.width * zoom,
          height: page.height * zoom,
          transform: rotationTransform(page.rotation, page.width * zoom, page.height * zoom),
        }}
      >
        {failed ? (
          <div className="flex h-full items-center justify-center text-sm text-red-600">
            This page could not be rendered.
          </div>
        ) : (
          src && <img src={src} alt="" draggable={false} className="h-full w-full select-none" />
        )}
        {children}
      </div>
    </div>
  );
}

/** Rotate about the top-left, then translate so the result sits flush. */
function rotationTransform(rotation: number, w: number, h: number): string {
  switch (rotation) {
    case 90:  return `translate(${h}px, 0) rotate(90deg)`;
    case 180: return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270: return `translate(0, ${w}px) rotate(270deg)`;
    default:  return 'none';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/PageCanvas.tsx
git commit -m "Add page canvas with CSS rotation transform"
```

---

## Task 14: Thumbnail rail

**Files:**
- Create: `src/components/ThumbnailRail.tsx`

- [ ] **Step 1: Implement**

```tsx
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '../pdf/renderPage';
import { useStore } from '../model/store';
import type { Page } from '../model/types';

interface Props { proxy: PDFDocumentProxy }

export function ThumbnailRail({ proxy }: Props) {
  const doc = useStore((s) => s.doc);
  const activePageId = useStore((s) => s.activePageId);
  const setActivePage = useStore((s) => s.setActivePage);
  const reorderPages = useStore((s) => s.reorderPages);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!doc) return null;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = doc.pages.findIndex((p) => p.id === active.id);
    const to = doc.pages.findIndex((p) => p.id === over.id);
    if (from >= 0 && to >= 0) reorderPages(from, to);
  };

  return (
    <div className="flex h-full w-44 flex-col gap-2 overflow-y-auto border-r border-edge bg-panel p-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={doc.pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {doc.pages.map((page, i) => (
            <Thumbnail
              key={page.id}
              proxy={proxy}
              page={page}
              index={i}
              active={page.id === activePageId}
              onSelect={() => setActivePage(page.id)}
              canDelete={doc.pages.length > 1}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface ThumbProps {
  proxy: PDFDocumentProxy;
  page: Page;
  index: number;
  active: boolean;
  canDelete: boolean;
  onSelect(): void;
}

function Thumbnail({ proxy, page, index, active, canDelete, onSelect }: ThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id });
  const deletePage = useStore((s) => s.deletePage);
  const rotatePage = useStore((s) => s.rotatePage);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderPage(proxy, page.sourceIndex, 0.3)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [proxy, page.sourceIndex]);

  const swapped = page.rotation === 90 || page.rotation === 270;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative ${isDragging ? 'z-10 opacity-80' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        {...attributes}
        {...listeners}
        className={`block w-full overflow-hidden rounded-lg border-2 bg-white transition-colors ${
          active ? 'border-accent' : 'border-edge hover:border-slate-400'
        }`}
      >
        <div className="flex aspect-[3/4] items-center justify-center overflow-hidden">
          {src && (
            <img
              src={src}
              alt={`Page ${index + 1}`}
              draggable={false}
              className="max-h-full max-w-full select-none"
              style={{
                transform: `rotate(${page.rotation}deg)`,
                maxHeight: swapped ? '75%' : '100%',
              }}
            />
          )}
        </div>
        <div className="border-t border-edge py-1 text-center text-xs text-slate-500">
          {index + 1}
        </div>
      </button>

      <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
        <IconButton label="Rotate left" onClick={() => rotatePage(page.id, -90)}>⟲</IconButton>
        <IconButton label="Rotate right" onClick={() => rotatePage(page.id, 90)}>⟳</IconButton>
        {canDelete && (
          <IconButton label="Delete page" danger onClick={() => deletePage(page.id)}>✕</IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton(
  { children, label, onClick, danger }:
  { children: React.ReactNode; label: string; onClick(): void; danger?: boolean },
) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-5 w-5 items-center justify-center rounded bg-white/90 text-xs shadow ring-1 ring-edge ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Install the dnd-kit utilities package**

```bash
npm install @dnd-kit/utilities
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ThumbnailRail.tsx package.json package-lock.json
git commit -m "Add draggable thumbnail rail with delete and rotate"
```

---

## Task 15: Object rendering

**Files:**
- Create: `src/components/ShapeObjectView.tsx`, `src/components/TextObjectView.tsx`, `src/components/ObjectLayer.tsx`

- [ ] **Step 1: Implement the shape view**

`src/components/ShapeObjectView.tsx`:

```tsx
import type { ShapeObject } from '../model/types';

interface Props { o: ShapeObject; zoom: number }

/**
 * Shapes render as inline SVG so the browser draws the same primitives the
 * exporter draws, in the same coordinate space (scaled by zoom).
 */
export function ShapeObjectView({ o, zoom }: Props) {
  const w = o.width * zoom;
  const h = o.height * zoom;
  const sw = o.strokeWidth * zoom;
  const common = {
    fill: o.fill,
    fillOpacity: o.fillOpacity,
    stroke: o.stroke,
    strokeWidth: sw,
    strokeOpacity: o.strokeOpacity,
  };
  // Inset by half the stroke so the outline is not clipped by the viewport.
  const i = sw / 2;

  return (
    <svg width={w} height={h} className="pointer-events-none block overflow-visible">
      {o.kind === 'rect' && (
        <rect
          x={i} y={i} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)}
          rx={(o.cornerRadius ?? 0) * zoom} {...common}
        />
      )}
      {o.kind === 'ellipse' && (
        <ellipse
          cx={w / 2} cy={h / 2}
          rx={Math.max(0, w / 2 - i)} ry={Math.max(0, h / 2 - i)} {...common}
        />
      )}
      {o.kind === 'triangle' && (
        <polygon points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`} {...common} />
      )}
      {o.kind === 'line' && (
        <line
          x1={0} y1={h} x2={w} y2={0}
          stroke={o.stroke} strokeWidth={sw} strokeOpacity={o.strokeOpacity}
        />
      )}
      {o.kind === 'arrow' && <Arrow o={o} w={w} h={h} sw={sw} />}
    </svg>
  );
}

function Arrow({ o, w, h, sw }: { o: ShapeObject; w: number; h: number; sw: number }) {
  const head = (o.arrowHeadSize ?? Math.max(6, o.strokeWidth * 3)) * (w / Math.max(o.width, 0.001));
  const sx = 0, sy = h, ex = w, ey = 0;
  const angle = Math.atan2(ey - sy, ex - sx);
  const bx = ex - Math.cos(angle) * head;
  const by = ey - Math.sin(angle) * head;
  const spread = Math.PI / 7;
  const p1x = ex - Math.cos(angle - spread) * head;
  const p1y = ey - Math.sin(angle - spread) * head;
  const p2x = ex - Math.cos(angle + spread) * head;
  const p2y = ey - Math.sin(angle + spread) * head;

  return (
    <>
      <line
        x1={sx} y1={sy} x2={bx} y2={by}
        stroke={o.stroke} strokeWidth={sw} strokeOpacity={o.strokeOpacity}
      />
      <polygon
        points={`${ex},${ey} ${p1x},${p1y} ${p2x},${p2y}`}
        fill={o.stroke} fillOpacity={o.strokeOpacity}
      />
    </>
  );
}
```

- [ ] **Step 2: Implement the text view**

`src/components/TextObjectView.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { getLoadedFont, layoutText, lineX, primeFont, variantOf } from '../pdf/fontMetrics';
import { useStore } from '../model/store';
import type { TextObject } from '../model/types';

interface Props {
  o: TextObject;
  zoom: number;
  editing: boolean;
  onFinishEditing(): void;
}

/**
 * Text renders one absolutely-positioned line per laid-out line, using the
 * SAME layoutText() the exporter uses. The browser never wraps: each line has
 * white-space: pre and kerning/ligatures disabled, so its advance widths match
 * what pdf-lib will draw.
 */
export function TextObjectView({ o, zoom, editing, onFinishEditing }: Props) {
  const variant = variantOf(o.bold, o.italic);
  const metrics = getLoadedFont(variant);
  const updateObject = useStore((s) => s.updateObject);
  const deleteObjects = useStore((s) => s.deleteObjects);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void primeFont(variant); }, [variant]);

  const layout = useMemo(
    () => (metrics ? layoutText(metrics, o.text, o.fontSize, o.width, o.lineHeight) : null),
    [metrics, o.text, o.fontSize, o.width, o.lineHeight],
  );

  // Height is derived from the layout, never set by the user.
  useEffect(() => {
    if (layout && Math.abs(layout.height - o.height) > 0.01) {
      updateObject(o.id, { height: layout.height });
    }
  }, [layout, o.height, o.id, updateObject]);

  useEffect(() => {
    if (editing) {
      textarea.current?.focus();
      textarea.current?.select();
    }
  }, [editing]);

  if (!layout) return null;

  const fontFamily = 'InterPdf, Inter, sans-serif';

  if (editing) {
    return (
      <textarea
        ref={textarea}
        value={o.text}
        onChange={(e) => updateObject(o.id, { text: e.target.value })}
        onBlur={() => {
          // An empty box would be invisible and unfindable, so drop it.
          if (o.text.trim() === '') deleteObjects([o.id]);
          onFinishEditing();
        }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onFinishEditing(); } }}
        className="pdf-text absolute left-0 top-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
        style={{
          width: o.width * zoom,
          height: Math.max(layout.height, o.fontSize * o.lineHeight) * zoom,
          fontFamily,
          fontSize: o.fontSize * zoom,
          lineHeight: `${layout.lineBoxHeight * zoom}px`,
          color: o.color,
          fontWeight: o.bold ? 700 : 400,
          fontStyle: o.italic ? 'italic' : 'normal',
          textAlign: o.align,
          whiteSpace: 'pre-wrap',
        }}
      />
    );
  }

  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: o.width * zoom, height: layout.height * zoom }}
    >
      {layout.lines.map((line, i) => (
        <div
          key={i}
          className="pdf-text absolute"
          style={{
            left: lineX(layout, i, o.align, o.width) * zoom,
            top: i * layout.lineBoxHeight * zoom,
            height: layout.lineBoxHeight * zoom,
            lineHeight: `${layout.lineBoxHeight * zoom}px`,
            fontFamily,
            fontSize: o.fontSize * zoom,
            color: o.color,
            fontWeight: o.bold ? 700 : 400,
            fontStyle: o.italic ? 'italic' : 'normal',
          }}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ShapeObjectView.tsx src/components/TextObjectView.tsx
git commit -m "Add shape and text object renderers"
```

---

## Task 16: Object layer with drag, resize, create and snapping

**Files:**
- Create: `src/components/ObjectLayer.tsx`, `src/components/SnapIndicators.tsx`

- [ ] **Step 1: Implement the snap indicators**

`src/components/SnapIndicators.tsx`:

```tsx
import type { SnapIndicator } from '../geometry/snapping';

interface Props { indicators: SnapIndicator[]; zoom: number }

export function SnapIndicators({ indicators, zoom }: Props) {
  return (
    <>
      {indicators.map((ind, i) => {
        if (ind.kind === 'object') {
          // Outline the object we snapped TO — this is the signal that tells
          // the user WHAT they aligned with, not merely where.
          return (
            <div
              key={`o${i}`}
              className="pointer-events-none absolute border-2 border-accent"
              style={{
                left: ind.rect.x * zoom,
                top: ind.rect.y * zoom,
                width: ind.rect.width * zoom,
                height: ind.rect.height * zoom,
              }}
            />
          );
        }
        if (ind.kind === 'page') {
          const style = ind.axis === 'x'
            ? { left: ind.position * zoom, top: 0, width: 1, height: '100%' }
            : { left: 0, top: ind.position * zoom, width: '100%', height: 1 };
          return (
            <div
              key={`p${i}`}
              className="pointer-events-none absolute border-dashed border-accent"
              style={{ ...style, borderLeftWidth: ind.axis === 'x' ? 1 : 0, borderTopWidth: ind.axis === 'y' ? 1 : 0 }}
            />
          );
        }
        return (
          <div key={`s${i}`}>
            {ind.gaps.map((g, j) => (
              <div
                key={j}
                className="pointer-events-none absolute bg-accent/20 ring-1 ring-accent"
                style={{ left: g.x * zoom, top: g.y * zoom, width: g.width * zoom, height: g.height * zoom }}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Implement the object layer**

`src/components/ObjectLayer.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';
import { useStore, nextId } from '../model/store';
import { displayToPage } from '../geometry/coords';
import { resolveSnap, type SnapIndicator, type SnapTarget } from '../geometry/snapping';
import { SnapIndicators } from './SnapIndicators';
import { ShapeObjectView } from './ShapeObjectView';
import { TextObjectView } from './TextObjectView';
import type { EditorObject, Page, Rect, ShapeKind, ShapeObject, TextObject } from '../model/types';
import { isText } from '../model/types';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = typeof HANDLES[number];

type Interaction =
  | { mode: 'create'; start: { x: number; y: number }; rect: Rect }
  | { mode: 'move'; ids: string[]; start: { x: number; y: number }; origins: Record<string, Rect> }
  | { mode: 'resize'; id: string; handle: Handle; origin: Rect }
  | null;

interface Props { page: Page; zoom: number }

export function ObjectLayer({ page, zoom }: Props) {
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const addObject = useStore((s) => s.addObject);
  const updateObjectTransient = useStore((s) => s.updateObjectTransient);
  const commitInteraction = useStore((s) => s.commitInteraction);
  const snapEnabled = useStore((s) => s.snapEnabled);

  const layer = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [indicators, setIndicators] = useState<SnapIndicator[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const altHeld = useRef(false);

  const objects = (doc ? page.objectIds.map((id) => doc.objects[id]).filter(Boolean) : []) as EditorObject[];

  /** Convert a pointer event into unrotated page coordinates. */
  const toPage = useCallback((e: { clientX: number; clientY: number }) => {
    const box = layer.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    // The layer is inside the rotated container, so its own box is already in
    // unrotated page space — only the zoom needs undoing.
    return { x: (e.clientX - box.left) / zoom, y: (e.clientY - box.top) / zoom };
  }, [zoom]);

  const targetsExcluding = useCallback((ids: string[]): SnapTarget[] =>
    objects.filter((o) => !ids.includes(o.id)).map((o) => ({
      id: o.id,
      rect: { x: o.x, y: o.y, width: o.width, height: o.height },
    })), [objects]);

  const snapOpts = useCallback((ids: string[]) => ({
    threshold: 6 / zoom, // threshold is in SCREEN pixels, so convert to points
    page: { width: page.width, height: page.height },
    enabled: snapEnabled && !altHeld.current,
    targets: targetsExcluding(ids),
  }), [zoom, page.width, page.height, snapEnabled, targetsExcluding]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    altHeld.current = e.altKey;
    const p = toPage(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (tool !== 'select') {
      setInteraction({ mode: 'create', start: p, rect: { x: p.x, y: p.y, width: 0, height: 0 } });
      setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
      return;
    }
    // Clicking empty canvas clears the selection.
    if (e.target === layer.current) select([]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interaction) return;
    altHeld.current = e.altKey;
    const p = toPage(e);

    if (interaction.mode === 'create') {
      let rect = normalise(interaction.start, p);
      if (e.shiftKey) rect = constrainSquare(interaction.start, rect);
      setDraft(rect);
      return;
    }

    if (interaction.mode === 'move') {
      const dx = p.x - interaction.start.x;
      const dy = p.y - interaction.start.y;
      const primary = interaction.ids[0];
      const origin = interaction.origins[primary];
      const moved: Rect = { ...origin, x: origin.x + dx, y: origin.y + dy };
      const opts = snapOpts(interaction.ids);
      const snapped = resolveSnap(moved, opts.targets, opts);
      setIndicators(snapped.indicators);
      const sdx = snapped.rect.x - origin.x;
      const sdy = snapped.rect.y - origin.y;
      for (const id of interaction.ids) {
        const o = interaction.origins[id];
        updateObjectTransient(id, { x: o.x + sdx, y: o.y + sdy });
      }
      return;
    }

    if (interaction.mode === 'resize') {
      const resized = applyHandle(interaction.origin, interaction.handle, p);
      const opts = snapOpts([interaction.id]);
      const snapped = resolveSnap(resized, opts.targets, opts);
      setIndicators(snapped.indicators);
      const obj = doc?.objects[interaction.id];
      // Text height is derived from layout, so only width is user-controlled.
      const patch = obj && isText(obj)
        ? { x: snapped.rect.x, y: snapped.rect.y, width: Math.max(12, snapped.rect.width) }
        : {
            x: snapped.rect.x, y: snapped.rect.y,
            width: Math.max(2, snapped.rect.width), height: Math.max(2, snapped.rect.height),
          };
      updateObjectTransient(interaction.id, patch);
    }
  };

  const onPointerUp = () => {
    if (interaction?.mode === 'create' && draft) {
      if (draft.width >= 4 && draft.height >= 4) createObject(draft);
      setDraft(null);
      setTool('select');
    } else if (interaction) {
      commitInteraction();
    }
    setInteraction(null);
    setIndicators([]);
  };

  const createObject = (rect: Rect) => {
    const id = nextId('obj');
    if (tool === 'text') {
      const o: TextObject = {
        id, pageId: page.id, kind: 'text', ...rect,
        text: 'Text', fontSize: 14, color: '#111111',
        bold: false, italic: false, align: 'left', lineHeight: 1.3,
      };
      addObject(o);
      setEditingId(id);
      return;
    }
    const o: ShapeObject = {
      id, pageId: page.id, kind: tool as ShapeKind, ...rect,
      fill: tool === 'line' || tool === 'arrow' ? 'none' : '#bfdbfe',
      fillOpacity: 1,
      stroke: '#1d4ed8', strokeWidth: 2, strokeOpacity: 1,
      cornerRadius: tool === 'rect' ? 0 : undefined,
      arrowHeadSize: tool === 'arrow' ? 10 : undefined,
    };
    addObject(o);
  };

  return (
    <div
      ref={layer}
      className="absolute inset-0"
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {objects.map((o) => {
        const selected = selection.includes(o.id);
        return (
          <div
            key={o.id}
            className="absolute"
            style={{ left: o.x * zoom, top: o.y * zoom, width: o.width * zoom, height: o.height * zoom }}
            onPointerDown={(e) => {
              if (tool !== 'select' || editingId === o.id) return;
              e.stopPropagation();
              altHeld.current = e.altKey;
              const ids = e.shiftKey
                ? Array.from(new Set([...selection, o.id]))
                : selection.includes(o.id) ? selection : [o.id];
              select(ids);
              const origins: Record<string, Rect> = {};
              for (const id of ids) {
                const t = doc?.objects[id];
                if (t) origins[id] = { x: t.x, y: t.y, width: t.width, height: t.height };
              }
              setInteraction({ mode: 'move', ids, start: toPage(e), origins });
            }}
            onDoubleClick={(e) => { if (isText(o)) { e.stopPropagation(); setEditingId(o.id); } }}
          >
            {isText(o) ? (
              <TextObjectView
                o={o} zoom={zoom}
                editing={editingId === o.id}
                onFinishEditing={() => { setEditingId(null); commitInteraction(); }}
              />
            ) : (
              <ShapeObjectView o={o} zoom={zoom} />
            )}

            {selected && editingId !== o.id && (
              <>
                <div className="pointer-events-none absolute -inset-px ring-1 ring-accent" />
                {HANDLES.map((h) => (
                  <div
                    key={h}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      altHeld.current = e.altKey;
                      setInteraction({
                        mode: 'resize', id: o.id, handle: h,
                        origin: { x: o.x, y: o.y, width: o.width, height: o.height },
                      });
                    }}
                    className="absolute h-2 w-2 rounded-sm border border-accent bg-white"
                    style={{ ...handlePosition(h), cursor: `${h}-resize` }}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}

      {draft && (
        <div
          className="pointer-events-none absolute border border-dashed border-accent bg-accent/10"
          style={{ left: draft.x * zoom, top: draft.y * zoom, width: draft.width * zoom, height: draft.height * zoom }}
        />
      )}

      <SnapIndicators indicators={indicators} zoom={zoom} />
    </div>
  );
}

function normalise(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
  };
}

function constrainSquare(start: { x: number; y: number }, r: Rect): Rect {
  const size = Math.max(r.width, r.height);
  return {
    width: size, height: size,
    x: r.x < start.x ? start.x - size : start.x,
    y: r.y < start.y ? start.y - size : start.y,
  };
}

function applyHandle(o: Rect, h: Handle, p: { x: number; y: number }): Rect {
  let { x, y, width, height } = o;
  if (h.includes('w')) { width = o.x + o.width - p.x; x = p.x; }
  if (h.includes('e')) { width = p.x - o.x; }
  if (h.includes('n')) { height = o.y + o.height - p.y; y = p.y; }
  if (h.includes('s')) { height = p.y - o.y; }
  return { x, y, width, height };
}

function handlePosition(h: Handle): React.CSSProperties {
  const v = h.includes('n') ? { top: -4 } : h.includes('s') ? { bottom: -4 } : { top: 'calc(50% - 4px)' };
  const z = h.includes('w') ? { left: -4 } : h.includes('e') ? { right: -4 } : { left: 'calc(50% - 4px)' };
  return { ...v, ...z };
}
```

Note: `resolveSnap` takes `(rect, targets, opts)`; `snapOpts` returns an object carrying `targets` alongside the options, and the extra key is harmless to `resolveSnap`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ObjectLayer.tsx src/components/SnapIndicators.tsx
git commit -m "Add object layer with create, move, resize and snapping"
```

---

## Task 17: Toolbar and properties panel

**Files:**
- Create: `src/components/Toolbar.tsx`, `src/components/PropertiesPanel.tsx`

- [ ] **Step 1: Implement the toolbar**

`src/components/Toolbar.tsx`:

```tsx
import { useStore } from '../model/store';
import type { ToolId } from '../model/types';

const TOOLS: { id: ToolId; label: string; key: string; glyph: string }[] = [
  { id: 'select', label: 'Select', key: 'V', glyph: '⌖' },
  { id: 'text', label: 'Text', key: 'T', glyph: 'T' },
  { id: 'rect', label: 'Rectangle', key: 'R', glyph: '▭' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', glyph: '◯' },
  { id: 'triangle', label: 'Triangle', key: 'Y', glyph: '△' },
  { id: 'line', label: 'Line', key: 'L', glyph: '╱' },
  { id: 'arrow', label: 'Arrow', key: 'A', glyph: '↗' },
];

export function Toolbar({ onExport, exporting }: { onExport(): void; exporting: boolean }) {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const fileName = useStore((s) => s.doc?.fileName);

  return (
    <div className="flex items-center gap-2 border-b border-edge bg-surface px-3 py-2">
      <div className="mr-2 max-w-48 truncate text-sm font-medium">{fileName}</div>

      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
          className={`h-8 w-8 rounded-md text-sm transition-colors ${
            tool === t.id ? 'bg-accent text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {t.glyph}
        </button>
      ))}

      <div className="mx-2 h-6 w-px bg-edge" />

      <button type="button" onClick={undo} title="Undo (Ctrl+Z)" className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100">↶</button>
      <button type="button" onClick={redo} title="Redo (Ctrl+Y)" className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100">↷</button>

      <div className="mx-2 h-6 w-px bg-edge" />

      <button type="button" onClick={() => setZoom(zoom - 0.25)} className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100">−</button>
      <span className="w-12 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom(zoom + 0.25)} className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100">+</button>

      <div className="ml-auto" />

      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {exporting ? 'Exporting…' : 'Export PDF'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement the properties panel**

`src/components/PropertiesPanel.tsx`:

```tsx
import { useStore } from '../model/store';
import { isText, type EditorObject } from '../model/types';

export function PropertiesPanel() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const updateObject = useStore((s) => s.updateObject);
  const deleteObjects = useStore((s) => s.deleteObjects);
  const bringToFront = useStore((s) => s.bringToFront);
  const sendToBack = useStore((s) => s.sendToBack);

  const o: EditorObject | undefined = selection.length === 1 ? doc?.objects[selection[0]] : undefined;

  if (!o) {
    return (
      <aside className="w-64 border-l border-edge bg-panel p-4 text-sm text-slate-400">
        {selection.length > 1 ? `${selection.length} objects selected` : 'Nothing selected'}
      </aside>
    );
  }

  const set = (patch: Partial<EditorObject>) => updateObject(o.id, patch);

  return (
    <aside className="w-64 space-y-5 overflow-y-auto border-l border-edge bg-panel p-4">
      {isText(o) ? (
        <Section title="Text">
          <Row label="Size">
            <NumberInput value={o.fontSize} min={4} max={200} step={1} onChange={(v) => set({ fontSize: v })} />
          </Row>
          <Row label="Colour">
            <ColorInput value={o.color} onChange={(v) => set({ color: v })} />
          </Row>
          <Row label="Line height">
            <NumberInput value={o.lineHeight} min={0.8} max={3} step={0.1} onChange={(v) => set({ lineHeight: v })} />
          </Row>
          <Row label="Style">
            <div className="flex gap-1">
              <Toggle on={o.bold} onClick={() => set({ bold: !o.bold })} label="B" bold />
              <Toggle on={o.italic} onClick={() => set({ italic: !o.italic })} label="I" italic />
            </div>
          </Row>
          <Row label="Align">
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((a) => (
                <Toggle key={a} on={o.align === a} onClick={() => set({ align: a })} label={a[0].toUpperCase()} />
              ))}
            </div>
          </Row>
        </Section>
      ) : (
        <Section title="Shape">
          {o.kind !== 'line' && o.kind !== 'arrow' && (
            <>
              <Row label="Fill"><ColorInput value={o.fill} onChange={(v) => set({ fill: v })} /></Row>
              <Row label="Fill opacity">
                <NumberInput value={o.fillOpacity} min={0} max={1} step={0.05} onChange={(v) => set({ fillOpacity: v })} />
              </Row>
            </>
          )}
          <Row label="Outline"><ColorInput value={o.stroke} onChange={(v) => set({ stroke: v })} /></Row>
          <Row label="Width">
            <NumberInput value={o.strokeWidth} min={0} max={40} step={0.5} onChange={(v) => set({ strokeWidth: v })} />
          </Row>
          <Row label="Outline opacity">
            <NumberInput value={o.strokeOpacity} min={0} max={1} step={0.05} onChange={(v) => set({ strokeOpacity: v })} />
          </Row>
          {o.kind === 'rect' && (
            <Row label="Corner radius">
              <NumberInput value={o.cornerRadius ?? 0} min={0} max={100} step={1} onChange={(v) => set({ cornerRadius: v })} />
            </Row>
          )}
          {o.kind === 'arrow' && (
            <Row label="Head size">
              <NumberInput value={o.arrowHeadSize ?? 10} min={2} max={60} step={1} onChange={(v) => set({ arrowHeadSize: v })} />
            </Row>
          )}
        </Section>
      )}

      <Section title="Position">
        <Row label="X"><NumberInput value={round(o.x)} step={1} onChange={(v) => set({ x: v })} /></Row>
        <Row label="Y"><NumberInput value={round(o.y)} step={1} onChange={(v) => set({ y: v })} /></Row>
        <Row label="W"><NumberInput value={round(o.width)} min={1} step={1} onChange={(v) => set({ width: v })} /></Row>
        {!isText(o) && (
          <Row label="H"><NumberInput value={round(o.height)} min={1} step={1} onChange={(v) => set({ height: v })} /></Row>
        )}
      </Section>

      <Section title="Arrange">
        <div className="flex gap-2">
          <SmallButton onClick={() => bringToFront(o.id)}>Front</SmallButton>
          <SmallButton onClick={() => sendToBack(o.id)}>Back</SmallButton>
        </div>
      </Section>

      <button
        type="button"
        onClick={() => deleteObjects([o.id])}
        className="w-full rounded-md border border-red-200 py-1.5 text-sm text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    </aside>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function NumberInput(
  { value, onChange, min, max, step }:
  { value: number; onChange(v: number): void; min?: number; max?: number; step?: number },
) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="w-24 rounded border border-edge px-2 py-1 text-right text-sm tabular-nums"
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <input
      type="color"
      value={value === 'none' ? '#ffffff' : value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-24 cursor-pointer rounded border border-edge"
    />
  );
}

function Toggle(
  { on, onClick, label, bold, italic }:
  { on: boolean; onClick(): void; label: string; bold?: boolean; italic?: boolean },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-7 w-7 rounded border text-sm ${on ? 'border-accent bg-accent text-white' : 'border-edge bg-white text-slate-600'}`}
      style={{ fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal' }}
    >
      {label}
    </button>
  );
}

function SmallButton({ children, onClick }: { children: React.ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex-1 rounded border border-edge bg-white py-1 text-xs hover:bg-slate-50">
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Toolbar.tsx src/components/PropertiesPanel.tsx
git commit -m "Add toolbar and object properties panel"
```

---

## Task 18: Keyboard shortcuts

**Files:**
- Create: `src/hooks/useKeyboard.ts`

- [ ] **Step 1: Implement**

```ts
import { useEffect } from 'react';
import { useStore, nextId } from '../model/store';
import type { EditorObject, ToolId } from '../model/types';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select', t: 'text', r: 'rect', o: 'ellipse', y: 'triangle', l: 'line', a: 'arrow',
};

/** True when focus is in a field, so shortcuts must not hijack typing. */
function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function useKeyboard() {
  useEffect(() => {
    let clipboard: EditorObject[] = [];

    const onKeyDown = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (inTextField(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); s.undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault(); s.redo(); return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const page = s.doc?.pages.find((p) => p.id === s.activePageId);
        if (page) s.select([...page.objectIds]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        clipboard = s.selection.map((id) => s.doc?.objects[id]).filter(Boolean) as EditorObject[];
        return;
      }
      if (mod && (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'd')) {
        e.preventDefault();
        const sources = e.key.toLowerCase() === 'd'
          ? (s.selection.map((id) => s.doc?.objects[id]).filter(Boolean) as EditorObject[])
          : clipboard;
        for (const src of sources) {
          if (!s.activePageId) continue;
          // Offset the copy so it does not land exactly on top of its source.
          s.addObject({ ...src, id: nextId('obj'), pageId: s.activePageId, x: src.x + 10, y: src.y + 10 });
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.length) { e.preventDefault(); s.deleteObjects(s.selection); }
        return;
      }

      if (e.key === 'Escape') { s.clearSelection(); s.setTool('select'); return; }

      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        for (const id of s.selection) {
          const o = s.doc?.objects[id];
          if (o) s.updateObject(id, { x: o.x + dx, y: o.y + dy });
        }
        return;
      }

      if (!mod && !e.altKey) {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) s.setTool(tool);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useKeyboard.ts
git commit -m "Add keyboard shortcuts for tools, selection and editing"
```

---

## Task 19: IndexedDB persistence

**Files:**
- Create: `src/model/persistence.ts`

- [ ] **Step 1: Implement**

```ts
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
      upgrade(d) { d.createObjectStore(STORE); },
    });
  }
  return dbPromise;
}

/**
 * Persistence is best-effort. A private window, a full quota or blocked site
 * data must degrade to in-memory rather than break editing, so every call is
 * wrapped and failure only flips a flag.
 */
export async function saveSession(doc: Doc): Promise<boolean> {
  if (!available) return false;
  try {
    const payload: StoredSession = {
      fileName: doc.fileName,
      sourceBytes: doc.sourceBytes.buffer.slice(0) as ArrayBuffer,
      pages: doc.pages,
      objects: doc.objects,
      savedAt: Date.now(),
    };
    await (await db()).put(STORE, payload, KEY);
    return true;
  } catch {
    available = false;
    return false;
  }
}

export async function loadSession(): Promise<Doc | null> {
  if (!available) return null;
  try {
    const s = (await (await db()).get(STORE, KEY)) as StoredSession | undefined;
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
  try { await (await db()).delete(STORE, KEY); } catch { /* best effort */ }
}

export const persistenceAvailable = () => available;

/** Debounce saves so a drag does not write on every frame. */
export function createAutosave(delay = 500): (doc: Doc) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (doc: Doc) => {
    clearTimeout(timer);
    timer = setTimeout(() => { void saveSession(doc); }, delay);
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/model/persistence.ts
git commit -m "Add best-effort IndexedDB session persistence"
```

---

## Task 20: Assemble the editor

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace `App.tsx` with the full editor**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useStore } from './model/store';
import { loadDocument, PdfLoadError } from './pdf/loadDocument';
import { exportPdf, type FontSet } from './pdf/exportPdf';
import { primeFont } from './pdf/fontMetrics';
import { createAutosave, loadSession, clearSession } from './model/persistence';
import { useKeyboard } from './hooks/useKeyboard';
import { DropZone } from './components/DropZone';
import { Toolbar } from './components/Toolbar';
import { ThumbnailRail } from './components/ThumbnailRail';
import { PageCanvas } from './components/PageCanvas';
import { ObjectLayer } from './components/ObjectLayer';
import { PropertiesPanel } from './components/PropertiesPanel';

export default function App() {
  const doc = useStore((s) => s.doc);
  const activePageId = useStore((s) => s.activePageId);
  const zoom = useStore((s) => s.zoom);
  const error = useStore((s) => s.error);
  const loadDoc = useStore((s) => s.loadDoc);
  const setError = useStore((s) => s.setError);
  const setSnapEnabled = useStore((s) => s.setSnapEnabled);

  const [proxy, setProxy] = useState<PDFDocumentProxy | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const autosave = useRef(createAutosave());

  useKeyboard();

  // Alt suppresses snapping while held.
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setSnapEnabled(false); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setSnapEnabled(true); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [setSnapEnabled]);

  // Restore a previous session, if one exists.
  useEffect(() => {
    void (async () => {
      const restored = await loadSession();
      if (!restored || useStore.getState().doc) return;
      try {
        const p = await pdfjs.getDocument({ data: restored.sourceBytes.slice() }).promise;
        setProxy(p);
        loadDoc(restored);
        void primeFont('regular');
      } catch {
        await clearSession();
      }
    })();
  }, [loadDoc]);

  useEffect(() => { if (doc) autosave.current(doc); }, [doc]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (useStore.getState().doc) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadDocument(file);
      setProxy(loaded.proxy);
      loadDoc(loaded.doc);
      void primeFont('regular');
    } catch (e) {
      setError(e instanceof PdfLoadError ? e.message : 'Something went wrong opening that file.');
    } finally {
      setBusy(false);
    }
  }, [loadDoc, setError]);

  const onExport = useCallback(async () => {
    const current = useStore.getState().doc;
    if (!current) return;
    setExporting(true);
    try {
      const [regular, bold, italic, boldItalic] = await Promise.all([
        primeFont('regular'), primeFont('bold'), primeFont('italic'), primeFont('boldItalic'),
      ]);
      const fonts: FontSet = { regular, bold, italic, boldItalic };
      const bytes = await exportPdf(current, fonts);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = current.fileName.replace(/\.pdf$/i, '') + '-edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [setError]);

  const activePage = useMemo(
    () => doc?.pages.find((p) => p.id === activePageId) ?? null,
    [doc, activePageId],
  );

  if (!doc || !proxy) {
    return busy
      ? <div className="flex h-full items-center justify-center text-slate-500">Opening…</div>
      : <DropZone onFile={onFile} error={error} />;
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar onExport={onExport} exporting={exporting} />
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="flex min-h-0 flex-1">
        <ThumbnailRail proxy={proxy} />
        <main className="flex-1 overflow-auto bg-slate-200 p-8">
          <div className="flex justify-center">
            {activePage && (
              <PageCanvas proxy={proxy} page={activePage} zoom={zoom}>
                <ObjectLayer page={activePage} zoom={zoom} />
              </PageCanvas>
            )}
          </div>
        </main>
        <PropertiesPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the whole app manually**

```bash
npm run dev
```

Check every one of these:
- Drop a PDF → thumbnails and the first page render.
- Drag a thumbnail → order changes. Delete → page disappears. Rotate → page turns.
- Press `R`, drag on the page → a rectangle appears and the tool returns to Select.
- Drag the rectangle near another object → the other object gets an accent outline and the drag snaps.
- Hold Alt while dragging → no snapping.
- Press `T`, drag → caret appears, typing works, text wraps at the box width.
- Change size/colour/alignment in the right panel → the text updates.
- Ctrl+Z / Ctrl+Y → changes undo and redo.
- Refresh the page → the document and edits come back.

- [ ] **Step 3: Run all tests and the build**

```bash
npm test
npm run build
```

Expected: all tests pass; build writes `dist/`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Assemble editor shell with export, autosave and restore"
```

---

## Task 21: Docker packaging

**Files:**
- Create: `Dockerfile`, `docker/nginx.conf`, `docker-compose.yml`, `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
**/node_modules
.git
.gitignore
*.md
docs
.env
.env.*
!.env.example
dist
coverage
.vscode
.idea
*.log
```

- [ ] **Step 2: Create `docker/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    gzip on;
    gzip_types text/css application/javascript application/wasm font/ttf image/svg+xml;
    gzip_min_length 1024;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /fonts/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # index.html names the hashed assets, so a cached copy survives a redeploy
    # and points at files that no longer exist. It must always revalidate.
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location = /healthz {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Create the `Dockerfile`**

```dockerfile
# ── Stage 1: Install deps ────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

# ── Stage 2: Build to dist (Vite) ────────────────────────
FROM deps AS build

WORKDIR /app
COPY . .

# `npm run build` = `tsc -b && vite build`, so type errors fail the image
# build rather than shipping.
RUN npm run build

# ── Stage 3: Production image ────────────────────────────
FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  app:
    image: pdf-editor:latest
    container_name: pdf-editor-app
    ports:
      - "${APP_PORT:-3007}:80"
    environment:
      NGINX_ENTRYPOINT_QUIET_LOGS: "1"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
```

- [ ] **Step 5: Build and run**

```bash
npm run deploy
```

- [ ] **Step 6: Verify the deployment**

```bash
docker compose ps
curl -f http://localhost:3007/healthz
curl -sI http://localhost:3007/ | grep -i cache-control
curl -sI http://localhost:3007/nonexistent-route | head -1
```

Expected: container healthy; `/healthz` returns `ok`; `/` carries `Cache-Control: no-cache`; a deep link returns `200` (SPA fallback), not 404.

- [ ] **Step 7: Verify an asset carries the immutable header**

```bash
ASSET=$(curl -s http://localhost:3007/ | grep -o '/assets/[^"]*\.js' | head -1)
curl -sI "http://localhost:3007$ASSET" | grep -i cache-control
```

Expected: `Cache-Control: public, immutable`.

- [ ] **Step 8: End-to-end check in a browser**

Open `http://localhost:3007`, load a real PDF, add a text box and a shape, reorder a page, export, and reopen the exported file. Text must be selectable in the viewer and positioned where the preview showed it.

- [ ] **Step 9: Commit**

```bash
git add Dockerfile docker/nginx.conf docker-compose.yml .dockerignore
git commit -m "Add multi-stage Docker build serving the production bundle via nginx"
```

---

## Self-review notes

**Spec coverage:** upload (12), page reorder/delete/rotate (14), text boxes (15, 17), shapes (15, 17), move/resize (16), snapping incl. spacing (6, 16), undo/redo (7, 18), copy/paste/duplicate/nudge (18), multi-select (16, 18), zoom (17), autosave (19, 20), export (11, 20), error handling (9, 19, 20), Docker (21). All covered.

**Known deviations from the spec, deliberate:**
- Page rotation is stored but objects live in *unrotated* page space, with rotation applied as a CSS transform. The spec said `coords` handles rotation; it does, more simply than originally imagined.
- Marquee selection is not implemented; Shift-click multi-select and Ctrl+A cover the same need with far less interaction code. Add later if it is missed.
