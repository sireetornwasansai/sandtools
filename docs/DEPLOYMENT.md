# Deployment

Order: **1) Google Cloud OAuth client → 2) Apps Script backend → 3) GitHub → 4) Vercel → 5) verify**.

## 1. Google OAuth client (Web)
1. Google Cloud Console → create/choose a project → *APIs & Services → OAuth consent screen*
   (User type **Internal** if you use Google Workspace, otherwise External). Scopes: `openid`, `email`, `profile`.
2. *Credentials → Create credentials → OAuth client ID → Web application*.
   **Authorized JavaScript origins**: `https://<your-app>.vercel.app` (and your custom domain, and `http://localhost:5173` for dev).
   No redirect URIs are needed (Google Identity Services popup).
3. Copy the **Client ID** (public). There is no client secret in this design.
4. Only for "Open from Drive": enable *Google Drive API* + *Google Picker API*, add scope `.../auth/drive.file`
   to the consent screen, create an **API key** restricted to your site's HTTP referrers and the Picker API.

## 2. Apps Script backend (`gas/`)
1. https://script.google.com → *New project* → paste `gas/Code.gs`; in *Project Settings* enable
   "Show appsscript.json" and paste `gas/appsscript.json` (or use `clasp push`).
2. Run `setup` once (authorise). It creates `SESSION_SECRET`.
3. *Project Settings → Script properties* → set:
   `GOOGLE_CLIENT_ID` = client ID above, `ALLOWED_EMAIL_DOMAIN` = e.g. `example.go.th` (comma-separated for several; empty = any Google account).
4. *Deploy → New deployment → Web app*: **Execute as: Me**, **Who has access: Anyone**.
   (The script only calls Google's token-verification endpoint; it never touches your Drive/Gmail.)
5. Copy the `/exec` URL. After editing code, use *Deploy → Manage deployments → Edit → New version* (the URL stays the same).
6. Check: open `<exec URL>?action=health` → `{"success":true,"data":{"status":"ok","configured":true,...}}`.

## 3. GitHub
```bash
git init && git add . && git commit -m "SAND Office Tools v1.0"
git branch -M main && git remote add origin git@github.com:<org>/sand-office-tools.git && git push -u origin main
```
`.env`, `dist/`, `node_modules/`, `.clasp.json` are git-ignored. Do not commit secrets (there are none in the repo).

## 4. Vercel
1. *Add New → Project → Import* the GitHub repo. Framework preset: **Other**. (`vercel.json` already sets build command
   `node scripts/build.mjs`, output `dist`, and the security headers.)
2. *Settings → Environment Variables* (Production + Preview), see `.env.example`:
   `SAND_GAS_URL`, `SAND_GOOGLE_CLIENT_ID`, `SAND_REQUIRE_LOGIN=true`, optional `SAND_GOOGLE_API_KEY`, `SAND_GOOGLE_APP_ID`,
   `SAND_MAX_FILE_SIZE_MB`, `SAND_CONVERSION_TIMEOUT_SEC`.
3. Deploy. Every push to `main` redeploys; PRs get preview URLs (add preview origins to the OAuth client if you test login there).
4. Optional hardening: Vercel *Deployment Protection* / custom domain with SSO.

## 5. Verify
Run through `docs/TESTING.md` → "Manual checklist". At minimum: login with an allowed and a disallowed account,
convert one DOCX and one PDF, make a QR and scan it with a phone, install as PWA and use QR/Markdown offline.

## Local development
```bash
npm install                  # only dev tooling (playwright, typescript)
npm run dev                  # http://localhost:5173  (no login unless SAND_* env vars are set)
SAND_GAS_URL=... SAND_GOOGLE_CLIENT_ID=... SAND_REQUIRE_LOGIN=true npm run dev
npm run build && npm run preview   # production build with real security headers
```
