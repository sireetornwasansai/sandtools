# Architecture

```
Browser (static site on Vercel)                      Google Apps Script web app
┌──────────────────────────────────────────┐        ┌──────────────────────────────┐
│ QR · File Converter│        │ health / version             │
│  (all processing happens locally)        │  POST  │ login  (verify ID token,     │
│                                          ├───────►│         domain allow-list,   │
│ Google Identity Services (sign-in button)│ text/  │         sign session)       │
│ Google Drive REST + Picker (drive.file)  │ plain  │ me     (validate session)    │
└──────────────────────────────────────────┘        └──────────────────────────────┘
         │ files never leave the browser                      │ stores nothing about files
         ▼                                                    ▼
 IndexedDB / localStorage (this browser only)          Script Properties (config + secret)
```

## Why the converter is in the browser (and not MarkItDown-in-Python)

MarkItDown is a Python library. **Google Apps Script cannot run Python**, so the originally planned
`Frontend → API → Python → MarkItDown` chain is impossible with a GAS backend. Instead of hiding that,
the converter is a JavaScript engine that follows MarkItDown's pipeline per format and is validated against
MarkItDown 0.1.5 output (see `tests/fixtures/*.expected.md`). Side benefit: files are never uploaded anywhere.

If byte-for-byte MarkItDown behaviour (or OCR / legacy `.xls`) is ever required, add a small Python service
(Cloud Run) and call it from `converter.js`; nothing else in the app needs to change.

## Folders

| Path | Purpose |
|---|---|
| `src/index.html`, `src/css/` | App shell and design system (CSS variables, light/dark) |
| `src/js/core/` | Router, store (settings/recent/IndexedDB), auth, GAS client, palette, Drive, helpers |
| `src/js/modules/` | One file per tool (`qr`, `converter`, `dashboard`, `settings`) plus DOM-free `*-engine.js` / `*-utils.js` that are unit tested |
| `src/js/modules/converters/` | File → Markdown engine (`docx`, `pptx`, `xlsx`, `csv`, `pdf`, `html-md`, `misc`, `common`) |
| `src/js/vendor/` | Vendored third-party code (pdf.js, marked, DOMPurify, JSZip, highlight.js, QR encoder) — no CDN at runtime |
| `gas/` | Google Apps Script backend (`Code.gs`, `appsscript.json`) |
| `scripts/` | Zero-dependency dev server, build (writes `config.js`, service worker), preview |
| `tests/` | `unit/` (node:test), `gas.test.mjs` (backend in a VM), `e2e/` (Playwright), `fixtures/` |

## Adding a module

1. Create `src/js/modules/<name>.js` exporting `mount(root, {params, navigate})` (optionally returning a cleanup function).
2. Add one entry to `TOOLS` in `src/js/core/routes.js`. Search, command palette, sidebar, mobile nav, dashboard card
   and lazy loading all derive from that registry.

## Data flow rules

* Client-side tools make **no network requests** with user content.
* Only `login`/`me`/`health` go to GAS. Tokens are never logged.
* Persisted in the browser: settings, recent list. "Clear local data" removes all of it.
