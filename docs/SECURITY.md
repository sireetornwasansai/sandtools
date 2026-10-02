# Security & Privacy

## Threat model in one paragraph
The site is a **public static app**; its code and `config.js` are visible to anyone who can reach the URL.
Tools run locally, so there is no server-side user data to steal. Sign-in therefore protects the *backend*
(login/session) and acts as a front gate, but cannot technically stop someone who copies the static files from
running the local tools. If the app itself must be unreachable to outsiders, put it behind Vercel Deployment
Protection / SSO or an IP allow-list in addition to Google sign-in.

## Controls implemented

| Area | Control | Where |
|---|---|---|
| Transport/headers | HTTPS (HSTS), CSP (`object-src 'none'`, `frame-ancestors 'none'`, `script-src` limited to self + Google), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy | `vercel.json` |
| Secrets | Frontend config contains public values only; `config-gen` whitelists keys (unit tested); secrets live in Script Properties | `scripts/config-gen.mjs`, `gas/Code.gs` |
| Identity | Google ID token verified by the backend: `aud`, `iss`, `exp`, `email_verified`, domain allow-list (also `hd`), HMAC-signed session, constant-time compare, allow-list re-checked on every `me` call | `gas/Code.gs`, `tests/gas.test.mjs` |
| Fail closed | Missing `GOOGLE_CLIENT_ID`/`SESSION_SECRET` → `NOT_CONFIGURED`; app stays locked when login is required | GAS + `auth.js` |
| Rate limiting | Global per-minute counter on `login` (Apps Script exposes no client IP) | `rateLimit()` |
| Request limits | 8 KB body, 4 KB token, JSON only | `doPost` |
| Logging | `timestamp, requestId, operation, success, ms, errorCode` only — never tokens, emails, file or document content | `audit()` (tested) |
| File upload (converter) | Extension + MIME + magic-byte validation, size limit (`SAND_MAX_FILE_SIZE_MB`), timeout, ZIP entry-count / per-part / total-expansion limits (zip-bomb), path-traversal and DOCTYPE/ENTITY (XXE) rejection, files never executed, nothing uploaded or persisted | `converters/common.js`, `index.js` |
| XSS | Markdown preview rendered by `marked` then sanitised by DOMPurify; no `<script>/<iframe>/<style>`, no `on*`, no `javascript:`; links get `noopener noreferrer nofollow`; **remote images blocked by default** (privacy; opt-in in Settings) | `markdown-render.js` (e2e tested) |
| Drive | Scope `drive.file` only (app-created or user-picked files); token in memory only, requested on click | `core/drive.js` |
| Offline cache | Service worker caches same-origin static files only; never intercepts Google/GAS traffic | `src/sw.js` |

## Healthcare data
The mandatory warning is shown on the dashboard and the converter page. Default posture: no patient data is
collected, uploaded, stored on a server, or logged. Settings and the recent list are kept in the browser's localStorage on that
device — on shared PCs use *Settings → Clear local data* (or a private window).

## Known limitations (be aware before go-live)
* Apps Script cannot read client IPs → rate limit is global, not per user.
* Google Sign-In consent screen, OAuth client and Apps Script deployment were **not** exercised end-to-end in
  development (no Google account/network available); they are covered by mocked tests. Follow `docs/DEPLOYMENT.md`
  and run the manual checklist in `docs/TESTING.md`.
* Content-Security-Policy keeps `style-src 'unsafe-inline'` (the UI sets a few inline styles).
* Not yet reviewed by a security professional or approved by hospital IT/PDPA officer.
