---
name: ciac-project
description: Overview, run/dev, build, and deploy instructions for the CIAC system (3CORE) — a React/Vite frontend + Express/MSSQL backend. Use when running, building, deploying, or navigating this repo.
---

# CIAC System (3CORE)

Full-stack app: React 19 + Vite frontend (`/`) and an Express backend (`server/`), split as two npm workspaces (root `package.json` declares `workspaces: ["server"]`). Used to manage lease applications, contracts, requirements/compliance, and inspections for locators (proponents).

## Stack

- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS 4, MUI 7 (+ `x-date-pickers-pro`), `recharts`, `sonner`, `lucide-react`, Firebase (client SDK for phone OTP).
- Backend: Express 4 (CommonJS), MSSQL (`mssql` / `msnodesqlv8`), `better-sqlite3` is also a root dependency (see `bizreg.db` at repo root — check `server/config/database.js` to confirm which DB is actually live), JWT auth via cookies (`jsonwebtoken`, `cookie-parser`), Firebase Admin (phone OTP verification), `nodemailer` for email, `node-cache`.

## Repo layout

```
src/                  Frontend (Vite root)
  components/         applications/, proponent/, dashboard/, auth/, FileMaintenance/, settings/, ui/
  layout/             AppLayout, AppView routing
  config/landingConfig.ts   per-view dashboard copy/stats registry
  context/, hooks/, state/  GlobalDateContext, etc.
server/               Backend (separate npm workspace, CommonJS)
  app.js              Express bootstrap, CORS allowlist, static files, DB init
  routes/r_*.js        one router per resource, mounted in routes/routes.js under /api/*
  controller/c_*.js    matches each router
  models/              Role, User, Proponent, Contract, ApplicationWorkflow, Requirement(Category),
                        ComplianceType, InspectionType, Notification, ControlPanelPermission, Auth
  middleware/m_auth.js  attachUserFromJwt, isAuthenticated
  config/               database.js, firebaseAdmin.js, mailer.js, cache.js
  lib/notificationStream.js
ecosystem.config.cjs   PM2 config (two apps: ciac-dev, ciac-backend-dev)
```

### API surface (mounted in `server/routes/routes.js`)

`/api/auth`, `/api/users`, `/api/roles`, `/api/proponents`, `/api/applications`, `/api/contracts`, `/api/notifications`, `/api/requirements`, `/api/requirement-categories`, `/api/inspection-types`, `/api/compliance-types`, `/api/control-panel`.

Auth: JWT stored in an httpOnly cookie; `attachUserFromJwt` middleware runs globally, `isAuthenticated` guards protected routes. Phone OTP login also available: `POST /api/auth/firebase-phone-login` (requires Firebase Admin credentials, returns same JWT-cookie session as password login — see root `README.md`).

## Ports & proxy

- Frontend dev server: `2500` (`vite.config.ts`, `host: 0.0.0.0`, `strictPort: true`).
- Backend: `process.env.PORT || 3100`.
- Vite proxies `/api` → `env.VITE_BACKEND_URL` (defaults to `http://127.0.0.1:2501` in `vite.config.ts`, but `.env.example` sets `VITE_BACKEND_URL=http://localhost:3100` — confirm the actual backend port matches whichever `.env` value is loaded before assuming which one is live).
- Backend CORS allowlist defaults to `http://localhost:2500` and `http://localhost:5173`, plus `FRONTEND_URL` / `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS` from env.

## Running it

Root scripts (`package.json`):

```bash
npm run dev        # vite dev --port 2500 (frontend only)
npm run dev:all     # runs frontend + `npm --prefix server run dev` concurrently
npm run build       # vite build
npm run start       # vite preview --port 2500
npm run lint        # tsc --noEmit
```

Backend only: `npm --prefix server run dev` (plain `node app.js`) or `npm --prefix server run start` (`NODE_ENV=production node app.js`).

Via PM2 (`ecosystem.config.cjs`, both apps have `watch: true`):

```bash
pm2 start ecosystem.config.cjs        # starts ciac-dev (frontend) + ciac-backend-dev
pm2 restart ciac-dev ciac-backend-dev
pm2 logs ciac-backend-dev
```

## Environment variables

Frontend (`.env`, Vite-exposed vars need `VITE_` prefix):
- `VITE_BACKEND_URL` — backend origin for the `/api` proxy.
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` — Firebase client config for phone OTP.
- `VITE_FIREBASE_PHONE_AUTH_TEST_MODE` — dev-only, use Firebase test phone numbers when `"true"`.
- `GEMINI_API_KEY` — injected into `process.env` at build time via `vite.config.ts` `define`.

Backend (`server/.env`):
- `PORT`, `NODE_ENV`
- `JWT_SECRET`
- `FRONTEND_URL` (also accepts `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS`, comma-separated)
- `DB_SERVER`, `DB_NAME`, `DB_TRUSTED_CONNECTION`, `DB_USER`, `DB_PASSWORD`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
- `FIREBASE_SERVICE_ACCOUNT_JSON` (stringified service account JSON) or `FIREBASE_SERVICE_ACCOUNT_BASE64`

## Build & deploy

```bash
npm run build     # emits static frontend to dist/
```

`dist/` is served as the built frontend; the Express server (`server/app.js`) serves its own static assets from `server/public` and JSON/API routes — the two are deployed/run as separate processes (see `ecosystem.config.cjs`), with the frontend's dev proxy (or a reverse proxy in production) routing `/api` to the backend port.

Auth/session guard on startup: `server/app.js` calls `initializeDatabase()` then `Role.ensureSchema()` / `User.ensureSchema()` before listening — if the DB is unreachable, the server still starts (login page still loads) but DB-backed routes will fail.

## Notes / gotchas

- `.env.example` (tracked in git) has a `GEMINI_API_KEY` value that looks like a live key format (`AIzaSy...`), not an obvious placeholder — verify whether it's a real, still-valid key and rotate/remove it if so.
- Root `package.json` lists `better-sqlite3` as a dependency and there's a `bizreg.db` at repo root, while the backend's primary DB config points at MSSQL (`mssql`/`msnodesqlv8` in `server/package.json`) — check `server/config/database.js` before assuming which datastore a given feature reads from.
