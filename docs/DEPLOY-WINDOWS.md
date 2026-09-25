# Deploying to the client's Windows Server (nginx)

The whole system runs on **one** Windows Server:

```
Browser ──HTTPS 443──▶ nginx ─┬─ /        → static files from dist/ (the React app)
                              └─ /api/*   → http://127.0.0.1:3100 (Node backend, server/)
                                                   │
                                                   ▼
                                              SQL Server
```

- **nginx** serves the built frontend (`dist/`) and forwards `/api` to the backend.
- **The backend** (`server/` folder) is a Node.js process on the same machine, installed as a Windows Service.
- PM2 and the Vite dev server are **not** used in production. The Windows Services start on boot and restart the process if it crashes.

---

## 1. One-time preparation on the server

Install:

| What | Notes |
|---|---|
| Node.js LTS (x64) | Default install path `C:\Program Files\nodejs\` |
| nginx for Windows | e.g. unzip to `C:\nginx` |
| NSSM | <https://nssm.cc>. Put `nssm.exe` on the PATH, e.g. in `C:\Windows\System32`. |
| ODBC Driver 18 for SQL Server | Only when using Windows authentication to SQL Server (`DB_TRUSTED_CONNECTION=true`) |
| An SSL certificate for the site's domain | Login needs HTTPS (see §7) |

Suggested folders (any paths work — adjust the commands below):

```
C:\ciac\server          backend code
C:\ciac\logs            backend logs
C:\nginx\html\ciac      frontend (contents of dist/)
D:\ciac-data\uploads    uploaded documents, certificates, profile photos (STORAGE_DIR)
```

Keep `STORAGE_DIR` **outside** `C:\ciac\server`, so replacing the code on an update can never touch uploaded files.

## 2. Build the frontend (on a dev machine)

```bash
npm ci
npm run build          # output: dist/
```

The build calls `/api` on its own origin, which nginx forwards to the backend. The dev `.env`'s `VITE_BACKEND_URL` is **not** used by the build. Leave `VITE_API_ORIGIN` unset unless the API really lives on a different domain.

For address autocomplete, set `VITE_GOOGLE_MAPS_API_KEY` in `.env` **before** building. Restrict that key to the client's domain in Google Cloud.

Copy the **contents** of `dist/` to `C:\nginx\html\ciac`.

## 3. Install the backend

Copy the `server/` folder to `C:\ciac\server`, **without** `node_modules`, `uploads` or `.env`. Then, in `C:\ciac\server`:

```bat
npm ci --omit=dev
npx playwright install chromium
```

Playwright's Chromium renders the contract and permit certificate PDFs. Without it, certificates fail to generate.

### `C:\ciac\server\.env`

Start from `server/.env.example`. Production values:

```ini
NODE_ENV=production
PORT=3100

# The exact public address of the site (CORS, CSRF check and password-reset links)
FRONTEND_URL=https://ciac.example.gov.ph

# Three DIFFERENT long random strings (e.g. 64 hex chars each).
# Never reuse the dev server's values. Keep a copy somewhere safe: losing
# APP_ENC_KEY makes stored TINs unreadable, and losing TOTP_ENC_KEY forces
# everyone to re-enroll their authenticator.
JWT_SECRET=...
APP_ENC_KEY=...
TOTP_ENC_KEY=...

DB_SERVER=localhost
DB_NAME=ciac
# Either SQL authentication:
DB_TRUSTED_CONNECTION=false
DB_USER=ciac_app
DB_PASSWORD=...
# ...or Windows authentication (see the note in §5):
# DB_TRUSTED_CONNECTION=true

STORAGE_DIR=D:\ciac-data\uploads

SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="3CORE Portal <no-reply@example.gov.ph>"
TOTP_ISSUER=3CORE Portal
```

Generate a random value with:

```bat
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Don't use `npm start` on Windows. Its `NODE_ENV=production node app.js` syntax is Linux-only. The service below runs `node app.js`, and `NODE_ENV` comes from `.env`.

## 4. Database and the first admin

Create an **empty** database (e.g. `ciac`) and a login that may create tables in it (`db_owner` on that database). Tables are created automatically the first time the backend starts.

A fresh database has no admin account. Create one after the backend has started once:

```bat
cd C:\ciac\server
node scripts\create-admin.js admin it@example.gov.ph "System Administrator"
```

It prints a temporary password **once**. Signing in with it asks for a new password straight away. Admins can then create every other account from inside the app, and set up role permissions under Settings → Control Panel.

> Don't restore the dev database (`bridge`) onto the client server. It holds test data and test accounts with weak passwords. Only do it if the client explicitly wants that data, and change every admin password right after.

## 5. Run the backend as a Windows Service

In a Command Prompt run **as Administrator**:

```bat
nssm install ciac-backend "C:\Program Files\nodejs\node.exe" app.js
nssm set ciac-backend AppDirectory C:\ciac\server
nssm set ciac-backend Start SERVICE_AUTO_START
nssm set ciac-backend AppStdout C:\ciac\logs\backend-out.log
nssm set ciac-backend AppStderr C:\ciac\logs\backend-error.log
nssm set ciac-backend AppRotateFiles 1
nssm set ciac-backend AppRotateOnline 1
nssm set ciac-backend AppRotateBytes 10485760
nssm start ciac-backend
```

Check `C:\ciac\logs\backend-out.log` for `CIAC server running` and `Connected to CIAC database successfully`.

**Windows authentication to SQL Server:** a service runs as `LocalSystem` by default, which usually has no SQL Server login. Either use SQL authentication, or open `services.msc` → **ciac-backend** → Log On, pick an account that has a login on the database, and restart the service.

**Firewall:** the backend listens on port 3100 on every interface. Block inbound 3100 in Windows Firewall, so the backend can only be reached through nginx:

```bat
netsh advfirewall firewall add rule name="Block CIAC backend direct" dir=in action=block protocol=TCP localport=3100
```

## 6. nginx

`C:\nginx\conf\nginx.conf` — inside `http { ... }`:

```nginx
server {
    listen 80;
    server_name ciac.example.gov.ph;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ciac.example.gov.ph;

    ssl_certificate     C:/nginx/ssl/ciac.crt;
    ssl_certificate_key C:/nginx/ssl/ciac.key;

    root C:/nginx/html/ciac;
    client_max_body_size 20m;              # document uploads go up to 15 MB

    # The React app does its own routing — unknown paths serve index.html.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Live notifications (Server-Sent Events): must not be buffered.
    location /api/notifications/stream {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Use forward slashes in Windows paths inside nginx.conf. Test the config with `C:\nginx\nginx.exe -t`, then install nginx as a service:

```bat
nssm install nginx C:\nginx\nginx.exe
nssm set nginx AppDirectory C:\nginx
nssm set nginx Start SERVICE_AUTO_START
nssm start nginx
```

Leave `TRUST_PROXY` unset. nginx on the same machine connects from 127.0.0.1, which the backend already trusts for the real client IP in the audit log.

## 7. HTTPS is required

With `NODE_ENV=production`, the login cookie is `Secure`, so browsers only send it over HTTPS. On plain `http://` the login appears to work and then immediately bounces back to the login page.

## 8. Backups (set up before go-live)

1. **Database:** schedule a daily full backup. If the database uses the FULL recovery model, also schedule log backups; otherwise the transaction log grows without limit. If point-in-time restore isn't needed, set the recovery model to SIMPLE instead.
2. **Files:** back up `STORAGE_DIR` (e.g. `D:\ciac-data\uploads`) on the same schedule. The database only stores file paths, so a DB backup alone can't restore the documents.
3. **Secrets:** keep a copy of `server\.env` (`JWT_SECRET`, `APP_ENC_KEY`, `TOTP_ENC_KEY`) somewhere safe, apart from the server.

## 9. Day-to-day operation

| Task | Command (as Administrator) |
|---|---|
| Restart the backend (after an update or a `.env` change) | `nssm restart ciac-backend` or `Restart-Service ciac-backend` |
| Status | `nssm status ciac-backend`, or `services.msc` |
| Reload nginx after a config change | `nssm restart nginx` |
| Logs | `C:\ciac\logs\backend-out.log` and `backend-error.log` |

**Rebooting the server:** nothing to do. Both services start automatically.

## 10. Deploying an update

1. Build the new `dist/` on a dev machine (§2).
2. `nssm stop ciac-backend`
3. Replace the code in `C:\ciac\server`. Keep its `.env`. Uploads are safe in `STORAGE_DIR`.
4. If `server/package.json` changed: `npm ci --omit=dev` in `C:\ciac\server`.
5. Replace the contents of `C:\nginx\html\ciac` with the new `dist/`.
6. `nssm start ciac-backend`

Schema changes apply themselves on startup. Unused old tables listed in `server/config/legacyTables.js` are dropped on startup too, so take the regular DB backup before updating. A release note will say if a one-off script in `server/scripts/` must be run.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Login succeeds, then straight back to the login page | Site not on HTTPS (§7), or the domain in the browser doesn't match `FRONTEND_URL` |
| "Cross-site request blocked" (403) on save | `FRONTEND_URL` doesn't exactly match the address in the browser (scheme, domain, port). Add extra addresses to `FRONTEND_ORIGINS`, comma-separated. |
| Every page errors, log says it can't connect to the database | `DB_*` settings, the SQL Server login, or the service's Log On account (§5) |
| Contract/permit certificate fails to generate | `npx playwright install chromium` wasn't run in `C:\ciac\server` |
| Uploads fail with 413 | nginx `client_max_body_size` is missing or too small |
| Notifications don't update live | The `/api/notifications/stream` block is missing, or buffering isn't off |
| No password-reset or account emails | `SMTP_*` settings. The error is in `backend-error.log`. |
