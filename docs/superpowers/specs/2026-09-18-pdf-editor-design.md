# Universal PDF Editor — Design

**Date:** 2026-09-18
**Status:** Approved

## Summary

A browser-based PDF editor. Upload a PDF, reorder and delete its pages, overlay
text boxes and shapes with full styling control, align them with snapping
feedback, and export a new PDF that matches the preview exactly.

Everything runs client-side. No server, no upload, no account. The user's
documents never leave their machine.

## Scope

### In scope

- Load a PDF from file picker or drag-and-drop.
- Page operations: reorder, delete, rotate ±90°.
- Text boxes: draw, type, style (size, colour, weight, italic, alignment, line
  height). Font family is always Inter.
- Shapes: rectangle, ellipse, triangle, line, arrow. Fill colour and opacity,
  stroke colour, width and opacity, corner radius (rectangles), head size
  (arrows).
- Move and resize objects by dragging, with snapping to other objects, page
  guides, and equal spacing.
- Undo/redo, copy/paste/duplicate, multi-select, keyboard nudge, zoom.
- Autosave to IndexedDB; work survives a refresh.
- Export a PDF with all edits applied.

### Out of scope for v1

Editing text that already exists in the uploaded PDF; rotating individual
objects; a layers panel beyond bring-to-front/send-to-back; image insertion;
form filling; digital signatures; freehand drawing; multi-document sessions.

Existing-PDF-text editing was explicitly considered and rejected: it requires
glyph extraction, paragraph inference, font matching against embedded subsets,
and content-stream surgery, and is unreliable even in commercial tools. This
editor is an **overlay editor** — the original page content is never modified.

## Architecture

### Rendering model

`pdf.js` rasterises each original page to a `<canvas>` that serves as an inert
backdrop. Every editable object is a real absolutely-positioned DOM element
layered above that canvas. DOM gives native text editing, cheap hit-testing,
and CSS-driven selection handles without reimplementing a caret.

Export is `pdf-lib`: it opens the **original bytes** and appends drawing
operators. Untouched page content stays vector-sharp, and added text exports as
real embedded-font text — selectable and searchable, not an image.

### The preview/export agreement problem

Two renderers exist in this system: the browser (what the user sees) and
`pdf-lib` (what they get). If they disagree about where a line of text breaks,
the export silently differs from the preview. This is the standard failure mode
of browser PDF editors.

The design removes the disagreement by removing the second decision-maker:

```
                 Inter .ttf file
                        |
                    fontkit
                        |
              layoutText(text, size, boxWidth)
                        |
            returns [{ line, x, y, width }, ...]
               /                       \
    DOM: one <div> per line      pdf-lib: one drawText per line
      white-space: pre              at identical coordinates
```

`layoutText` computes line breaks from advance widths read directly out of the
Inter font file. Both renderers consume its output. Each line is rendered in
the DOM with `white-space: pre`, so the browser is never permitted to make a
wrapping decision of its own. Preview/export agreement becomes a structural
property rather than something to verify by eye.

### Coordinate system

Objects are stored in **PDF points, page-relative, origin top-left, y-down**.
This matches DOM intuition and keeps the model readable.

Two conversions happen at the edges:

- **Screen:** multiply by the current zoom scale.
- **Export:** flip y (`pdfY = pageHeight - y - height`) because PDF's origin is
  bottom-left and y-up, then apply the page's `/Rotate` transform.

Centralising both in `geometry/coords` keeps the y-flip in exactly one place.
Page rotation is applied at render *and* export, so an object placed on a
rotated page lands where the user put it.

### Modules

Pure logic is kept out of React so the difficult parts are unit-testable
without a DOM.

| Module | Responsibility | Depends on |
|---|---|---|
| `pdf/loadDocument` | open file, page count, page sizes, `/Rotate`, encryption detection | pdf.js |
| `pdf/renderPage` | page → canvas bitmap at a given scale, with cache | pdf.js |
| `pdf/fontMetrics` | Inter advance widths, `layoutText()` | fontkit |
| `pdf/exportPdf` | apply page order/rotation, draw objects | pdf-lib, fontMetrics |
| `geometry/coords` | PDF points ↔ screen px, y-flip, page rotation | — |
| `geometry/snapping` | candidate lines, spacing runs, `resolve()` | coords |
| `model/types` | `Document`, `Page`, `TextObject`, `ShapeObject` | — |
| `model/store` | document, objects, selection, tool state | zustand |
| `model/history` | undo/redo snapshot stack | — |
| `model/persistence` | IndexedDB autosave and restore | — |
| `components/*` | Toolbar, ThumbnailRail, PageCanvas, ObjectLayer, TextObject, ShapeObject, SelectionBox, SnapIndicators, PropertiesPanel | React |

`snapping`, `coords`, `fontMetrics` and `exportPdf` hold essentially all the
real logic and carry the test burden. React components stay thin.

### Stack

Vite, React, TypeScript, Zustand, Tailwind, `@dnd-kit` (thumbnail reordering),
`pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit`. Vitest for unit tests.

Inter Regular / Italic / Bold / BoldItalic ship as static `.ttf` assets. The
app works offline and export never depends on a font CDN.

## Data model

```ts
type ObjectId = string;
type PageId = string;

interface Doc {
  sourceBytes: Uint8Array;      // the original, never mutated
  pages: Page[];                // order here IS the export order
  objects: Record<ObjectId, EditorObject>;
}

interface Page {
  id: PageId;
  sourceIndex: number;          // index in the original document
  rotation: 0 | 90 | 180 | 270; // user rotation, added to the source /Rotate
  width: number;                // points
  height: number;
  objectIds: ObjectId[];        // array order is z-order, last = front
}

interface BaseObject {
  id: ObjectId;
  pageId: PageId;
  x: number; y: number; width: number; height: number;  // points, top-left origin
}

interface TextObject extends BaseObject {
  kind: 'text';
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;           // multiplier
}

interface ShapeObject extends BaseObject {
  kind: 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';
  fill: string;
  fillOpacity: number;          // 0–1
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  cornerRadius?: number;        // rect only
  arrowHeadSize?: number;       // arrow only
}
```

A text object's `height` is **derived** from `layoutText`, not user-set. The
user controls width; height follows the content.

## Snapping

### Algorithm

On each drag/resize frame, for the object being manipulated:

1. Collect **candidate lines** from every other object on the page: vertical
   lines at its left, horizontal-centre and right; horizontal lines at its top,
   vertical-centre and bottom. Add page candidates: left/right edges,
   top/bottom edges, horizontal centre, vertical centre.
2. Compute the moving object's own six edges.
3. For each axis independently, find the candidate within the threshold whose
   distance is smallest. Apply that single offset to the axis.
4. **Spacing detection:** find runs of three or more objects aligned on the
   perpendicular axis with equal gaps. If placing the moving object would
   continue the run with that same gap (within threshold), offer that position
   as a candidate too.
5. Return a `SnapResult` naming the offset applied per axis and the source of
   each snap, so the UI can draw the right indicator.

Axes resolve independently — an object can snap left-edge to one object and
top-edge to a different one at the same time.

### Threshold

6 **screen** pixels, converted to points by dividing by the zoom scale. A
points-based threshold would feel sticky at 200% zoom and useless at 50%.

### Feedback

| Snap kind | Indicator |
|---|---|
| Object edge/centre | 2px accent outline drawn around the object snapped **to** |
| Page guide | thin dashed accent line along that page edge or centreline |
| Equal spacing | small matched bars drawn inside each equal gap |

Outlining the source object (rather than drawing an infinite guide line, the
common convention) answers the question the user actually has: *what* did I
align to.

Holding <kbd>Alt</kbd> suppresses snapping for the duration of the drag.
Snapping applies to both moving and resizing.

## Interactions

### Tools

Select (V), Text (T), Rectangle (R), Ellipse (O), Triangle (Y), Line (L),
Arrow (A).

Every creation tool behaves identically: drag on the page to define the
bounding box, then the tool reverts to Select with the new object selected.
<kbd>Shift</kbd> while drawing constrains to a square/circle, or to 45°
increments for lines and arrows.

### Text boxes

Drawing a text box places the caret immediately. Double-clicking an existing
box re-enters editing. Width is fixed by the user; text wraps within it and the
box grows downward. Horizontal resize re-wraps; vertical resize handles are
disabled.

An empty text box is discarded on blur, so the document never accumulates
invisible objects the user cannot find.

### Pages

Thumbnails drag to reorder with a live insertion line. Delete via a hover ✕ or
the <kbd>Delete</kbd> key. Deletion is undoable and therefore has no
confirmation dialog. Rotate ±90° per page.

Thumbnails render lazily and cache, so a 200-page document does not stall on
load.

### Keyboard

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>V</kbd> / <kbd>D</kbd> | Copy / paste / duplicate |
| <kbd>Delete</kbd> | Delete selection |
| Arrow keys | Nudge 1pt (10pt with <kbd>Shift</kbd>) |
| <kbd>Esc</kbd> | Deselect, or exit text editing |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> | Select all objects on the page |

Multi-select via <kbd>Shift</kbd>-click or marquee drag; group moves snap using
the union bounding box.

## Export

1. Create a new `PDFDocument`.
2. Copy source pages in `pages[]` order. Deleted pages are simply never copied.
3. Apply each page's user rotation.
4. Embed the Inter variants actually used, via fontkit.
5. For each page, draw its objects in `objectIds` order (back to front),
   converting coordinates through `geometry/coords`.
   - Text: one `drawText` per line from `layoutText`, at the exact coordinates
     the preview used.
   - Shapes: `drawRectangle` / `drawEllipse` / `drawSvgPath` with the stored
     fill, stroke and opacity.
6. Serialise and trigger a browser download.

## Persistence

The store is written to IndexedDB on a debounced schedule (500ms after the last
mutation). One record holds the original `sourceBytes` plus the serialised page
and object model — enough to fully reconstruct the session.

On startup, if a saved record exists, the document is restored and the user is
told which file was recovered, with the option to discard it and start fresh.
Undo history is deliberately **not** persisted: restoring a half-remembered
undo stack across sessions is more confusing than starting clean.

Loading a new document replaces the saved record.

## Error handling

| Condition | Behaviour |
|---|---|
| Not a PDF / corrupt bytes | Inline error on the drop zone, document not loaded |
| Password-protected | Detected on load; clear message that encrypted PDFs are unsupported |
| Page render failure | That page shows an error placeholder; the rest of the document stays usable |
| Export failure | Error surfaced with the failing page number; editor state untouched |
| IndexedDB unavailable or full | Autosave silently degrades to in-memory; a one-time non-blocking notice |
| Unload with unsaved changes | `beforeunload` warning |

Failures are contained to the page or feature that failed. A single bad page
never takes down the session.

## Testing

Unit tests (Vitest) on the modules holding the logic:

- **`fontMetrics`** — line breaking at exact widths, long unbreakable words,
  empty strings, trailing whitespace, multi-line input.
- **`coords`** — round-trip screen ↔ points at several zooms; y-flip; all four
  page rotations.
- **`snapping`** — each candidate type in isolation; nearest-wins when several
  are in range; independent axis resolution; threshold behaviour across zoom;
  equal-spacing run detection; Alt suppression.
- **`exportPdf`** — given a fixture PDF and a known object set, assert page
  count and order after deletion/reorder, and that produced text is extractable
  at expected coordinates.
- **`history`** — undo/redo across every mutation kind.

The critical correctness test is the export round-trip: build a document with
known objects, export, re-parse, and assert positions match what `layoutText`
produced. That is what proves preview and export have not drifted apart.

React components are verified by use rather than by test, since they hold
little logic once the pure modules are extracted.
