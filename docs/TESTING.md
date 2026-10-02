# Testing

```bash
npm install && npx playwright install chromium
npm run typecheck     # JSDoc types via tsc (checkJs)
npm test              # 46 unit tests + 11 backend tests (Code.gs executed in a Node VM with mocked Apps Script services)
npm run test:e2e      # browser tests against the production build (set LANG=C.UTF-8 on minimal Linux images for Thai file names)
```

Fixtures in `tests/fixtures/` were generated with python-docx / python-pptx / openpyxl / LibreOffice; `*.expected.md`
are the output of the real **MarkItDown 0.1.5**. `bomb*.docx|xlsx`, `xxe.docx`, `traversal.docx`, `corrupt.docx`,
`fake.docx`, `legacy.xls`, `encrypted.docx` are hostile inputs.

## Automated coverage
Dashboard & privacy warning · command palette · theme/sidebar persistence · every route (console/CSP errors, accessible names) ·
QR (7 payload types, PNG/SVG download, decoded with OpenCV, error on oversize, low-contrast warning) ·
Converter (DOCX, PPTX, XLSX, CSV, HTML, TXT, PDF; result actions; Convert→Edit→Preview→Download; drag & drop routing) ·
Hostile files (zip bombs, XXE, corrupt, wrong type, legacy, empty, oversize, MIME mismatch) ·
Settings (clear local data wipes localStorage) ·
Authentication against a mocked backend (locked until accepted, domain rejection, forged session, unreachable backend) ·
Mobile 390px (no horizontal overflow on every page, bottom nav) · PWA offline (QR, DOCX and PDF conversion) · security headers.

## Manual checklist (not automatable here)
- [ ] Real Google sign-in: allowed account OK; account outside `ALLOWED_EMAIL_DOMAIN` rejected; sign-out works
- [ ] Apps Script `?action=health` shows `configured:true`; Settings → "ตรวจสอบ Backend" is green
- [ ] Drive: *Save to Drive* creates a file; *Open from Drive* picks a `.md` (needs API key/App ID)
- [ ] Convert real office documents (include Thai documents, a large PDF, a password-protected file)
- [ ] Scan a generated QR (URL, Wi-Fi, vCard) with iOS and Android phones
- [ ] iPhone Safari and Android Chrome: layout, bottom nav
- [ ] Firefox & Safari desktop; Windows high-contrast; keyboard-only run-through; screen reader spot check (NVDA/VoiceOver)
- [ ] Install as PWA on desktop and phone; airplane-mode use of QR/File Converter
- [ ] Hospital IT/PDPA review before use with any real data
