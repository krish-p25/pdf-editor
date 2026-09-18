# PDF Editor — free online PDF editor that works entirely in your browser

**[Open the editor → pdf.krishrp.xyz](https://pdf.krishrp.xyz/)**

A free, no-signup PDF editor for the things people actually need to do to a PDF: **reorder pages, delete pages, rotate pages, and add text boxes, arrows and shapes on top.** Then export a new PDF with your changes baked in.

**Your files never leave your computer.** There is no upload, no server, no account, and no file-size queue. The PDF is opened, edited and re-saved by JavaScript running in your own browser tab — you can disconnect from the internet after the page loads and everything still works.

---

## Why another PDF editor?

Most free PDF tools online ask you to upload your document to someone else's server, wait in a queue, watch an advert, and then hand back a watermarked file. That is a bad trade for a contract, a payslip, an invoice or a passport scan.

This one does the work locally. No upload means no privacy question to worry about, no file-size limit beyond your own RAM, and instant results.

| | This editor | Typical free online PDF tools |
|---|---|---|
| Files uploaded to a server | **Never** | Yes |
| Account / email required | **No** | Often |
| Watermark on the output | **No** | Often |
| Page limits or daily quota | **No** | Usually |
| Works offline once loaded | **Yes** | No |
| Self-hostable | **Yes** (one Docker command) | No |

---

## What you can do

### Page management
- **Reorder pages** — drag thumbnails in the sidebar
- **Delete pages** — remove any page you don't want (undoable)
- **Rotate pages** — ±90° per page, for scans that arrive sideways

### Adding text to a PDF
- Draw a text box anywhere on the page and type
- Set **size, colour, bold, italic, alignment and line height**
- Text is exported as **real, selectable, searchable PDF text** — not a flattened image
- Set in [Inter](https://rsms.me/inter/), embedded in the exported file so it renders identically everywhere

### Shapes and annotations
- **Rectangles, ellipses, circles, triangles, lines and arrows**
- Fill colour and opacity, outline colour, width and opacity
- Corner radius on rectangles, adjustable head size on arrows

### Precise placement
- **Snapping** to other objects' edges and centres, to the page edges and centrelines, and to equal spacing between objects
- The object you snapped *to* is highlighted, so you can see what you lined up with
- Hold <kbd>Alt</kbd> to place something freely

### Not supported
This is an **overlay editor** — it adds content on top of your pages. It does **not** retype or reflow text that is already in the PDF, and it does not fill forms or add digital signatures. Those need a different class of tool, and any project claiming to do them reliably in a browser is overselling.

---

## Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>V</kbd> | Select tool |
| <kbd>T</kbd> | Text box |
| <kbd>R</kbd> / <kbd>O</kbd> / <kbd>Y</kbd> | Rectangle / ellipse / triangle |
| <kbd>L</kbd> / <kbd>A</kbd> | Line / arrow |
| <kbd>Enter</kbd> or <kbd>F2</kbd> | Edit the selected text box |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>V</kbd> / <kbd>D</kbd> | Copy / paste / duplicate |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> | Select everything on the page |
| Arrow keys | Nudge 1pt (10pt with <kbd>Shift</kbd>) |
| <kbd>Shift</kbd> while drawing | Constrain to a square or circle |
| <kbd>Alt</kbd> while dragging | Turn snapping off |
| <kbd>Delete</kbd> | Delete selection |
| <kbd>Esc</kbd> | Deselect / leave text editing |

---

## Your work is saved automatically

Edits are written to your browser's IndexedDB as you go, so closing the tab by accident doesn't lose an hour's work — reopen the page and it comes back.

For anything you care about, use **Save backup**. It downloads a single `.json` file containing the original PDF *and* every edit, which **Restore** loads back on any machine. That file is the portable, re-editable version of your work; the exported PDF is the finished article.

---

## Self-hosting

The whole app is static files, so hosting it is trivial.

```bash
git clone https://github.com/krish-p25/pdf-editor.git
cd pdf-editor
npm run deploy
```

That builds a production bundle inside Docker and serves it with nginx on **http://localhost:3007**. Change the published port with `APP_PORT`:

```bash
APP_PORT=8080 docker compose up -d
```

There is no database, no API key and no environment configuration — there is no server-side component at all.

### Running from source

```bash
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Run the test suite |
| `npm run deploy` | Build the Docker image and start the container |

---

## How it works

Two libraries do the heavy lifting: **pdf.js** rasterises each page as a backdrop to edit against, and **pdf-lib** writes the exported file by appending drawing operations to your *original* bytes — so untouched page content stays vector-sharp rather than being re-encoded as an image.

The interesting problem is that those are two different renderers: the browser draws what you see, and pdf-lib draws what you get. If they disagree about where a line of text breaks, your export silently differs from the preview. This project solves that by giving both of them the same line-breaking function, driven by advance widths read straight out of the Inter font file — the browser is never allowed to make a wrapping decision of its own.

Two details that turn out to matter:

- **Kerning is off.** pdf-lib writes a plain glyph string and the viewer advances using the font's widths array, so no kerning is applied. The preview therefore has to disable kerning too, or it drifts several percent narrower on strings like "AV Wa To".
- **Pages are rasterised at your device pixel ratio**, not at the CSS scale, so text stays crisp on high-DPI screens instead of looking soft.

**Built with:** TypeScript, React, Vite, Tailwind CSS, Zustand, pdf.js, pdf-lib, fontkit. Tested with Vitest.

---

## Browser support

Any current version of Chrome, Edge, Firefox, Safari or another Chromium-based browser. It needs a desktop-sized window — precise drag-and-drop editing on a phone screen isn't a good experience, so mobile isn't a target.
