# SAND Office Tools

**SAND — Sansai Administration Network** · เครื่องมือดิจิทัลสำหรับงานสำนักงาน ในที่เดียว

Personal & office utility web app for hospital/office staff. Two tools in one portal (QR Code + File Converter), Thai-first UI,
privacy-first (everything runs in the browser), small Google Apps Script backend for sign-in.

## Features
| Tool | What it does |
|---|---|
| **QR Code** | URL, text, Wi-Fi, email, phone, SMS, vCard · size, margin, error correction, colours, square/rounded/dots, centre logo · live preview · PNG/SVG download · copy image/content · contrast warnings |
| **File Converter** | PDF, DOCX, PPTX, XLSX, CSV, HTML, TXT (+ image info) → Markdown, in the browser. Drop → convert → preview / download `report.md` / copy |
| **Everywhere** | Command palette (Ctrl+K), tool search, drag & drop routing, PWA/offline, recent items (local), Settings, responsive (bottom nav on mobile), accessibility (labels, focus, reduced motion) |

## Important design decisions
* **Backend = Google Apps Script** (as requested) → it can't run Python, so **MarkItDown itself is not executed**.
  The converter is a JS engine that mirrors MarkItDown's pipeline and was checked against MarkItDown 0.1.5 output. Details & trade-offs: `docs/ARCHITECTURE.md`.
* **No build toolchain / no React**: plain ES modules + vendored libraries, typed with JSDoc (`npm run typecheck`). Deploys as static files on Vercel.
* Client-side tools never send your content anywhere.

## Quick start
```bash
npm install            # dev tooling only
npm run dev            # http://localhost:5173
npm run test:all       # typecheck + unit + backend + e2e
npm run build          # → dist/
```

## Configuration
Frontend (Vercel env, public values) and backend (Apps Script *Script properties*): see `.env.example`.

| Variable | Where | Meaning |
|---|---|---|
| `SAND_GAS_URL` | Vercel | Apps Script `/exec` URL |
| `SAND_GOOGLE_CLIENT_ID` | Vercel | OAuth Web client ID |
| `SAND_REQUIRE_LOGIN` | Vercel | `true` = must sign in |
| `SAND_MAX_FILE_SIZE_MB`, `SAND_CONVERSION_TIMEOUT_SEC` | Vercel | converter limits (25 MB / 60 s) |
| `SAND_GOOGLE_API_KEY`, `SAND_GOOGLE_APP_ID` | Vercel | optional, Drive Picker |
| `GOOGLE_CLIENT_ID`, `ALLOWED_EMAIL_DOMAIN`, `ALLOWED_EMAILS`, `SESSION_SECRET`, `SESSION_TTL_MIN`, `LOGIN_LIMIT_PER_MIN` | Apps Script | server-side policy and secret (never in Git/Vercel) |

## Docs
`docs/DEPLOYMENT.md` (Google OAuth, Apps Script, GitHub, Vercel) · `docs/SECURITY.md` · `docs/ARCHITECTURE.md` · `docs/TESTING.md`

## Converter limitations
PDF: text layer only (no OCR), tables become plain text, Thai PDFs whose fonts lack Unicode maps come out garbled (MarkItDown has the same problem — the UI warns) ·
DOCX/PPTX: no charts, text boxes (DOCX), SmartArt; images are referenced, not embedded · XLSX: cached values (not formulas); legacy `.xls` unsupported (save as `.xlsx`) · images: file info only.

## Troubleshooting
* *Login says "ไม่สามารถยืนยันตัวตนได้"* → client ID in Vercel and Script properties must match; add the site origin to the OAuth client.
* *Backend status red in Settings* → redeploy Apps Script as Web app, access "Anyone", use the `/exec` URL; run `setup` once.
* *Thai file names missing in downloads on Linux CI* → run with `LANG=C.UTF-8`.
* *Old version after deploy* → service worker cache; hard-reload once (cache key changes every build).

## QR ที่แนบกับโครงการ (v1.6.0)
* **QR ที่สร้างในระบบ** — ทุกรายการในชีต `Links` บันทึก `ที่มา`, `ลิงก์ย่อ (URL)`, `ปลายทาง`, `รูป QR (Drive id)`, `รูป QR (URL)` (คอลัมน์ 15–18) และรูป PNG ถูกเก็บใน `DRIVE_FOLDER_ID/<yyyy-MM>/<อีเมล>/QR/`
* **QR เดิมจากที่อื่น** (`kind = qrx`) — หน้า ประวัติ QR / แท็บ QR ของโครงการ → “แนบ QR เดิม”: อัปโหลดรูป ระบบอ่านที่อยู่ใน QR ในเบราว์เซอร์ (jsQR) เก็บรูปลง Drive และบันทึกปลายทาง
  * QR เดิมนับ “จำนวนสแกน” ไม่ได้ (ไม่ผ่านลิงก์ย่อ) จึงแสดง **จำนวนเปิดหน้าปลายทางรายวัน** จากตัวนับของโครงการ (`t.js`) — ถ้าที่อยู่ใน QR มี `?utm_source=…` จะนับเฉพาะผู้ที่เข้ามาทาง QR นั้น
* หลังวางไฟล์ `gas/*.gs` ใหม่: **Deploy → จัดการการติดตั้ง → แก้ไข → เวอร์ชันใหม่**, รัน `setupLinks` และ `setupAnalytics` หนึ่งครั้ง (เพิ่มหัวคอลัมน์ 15–18)
