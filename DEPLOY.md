# Deploying the Phase 1 demo

Two ways to let the client check the work: an **instant tunnel** (already running) and
a **permanent hosted URL on Render**.

---

## A. Instant public link — Cloudflare quick tunnel (already live)

A tunnel is already exposing your locally-running server to the internet:

- **URL:** printed in the terminal running `cloudflared` (e.g. `https://<name>.trycloudflare.com`)
- **Login:** user `ticash` · password `demo2026` (HTTP Basic auth)
- Open `<url>/admin`

Notes:
- Works only while **your PC is on** and both processes (the server + cloudflared) run.
- The URL is **temporary** — a new one is generated each time you restart cloudflared.
- To start it yourself later:
  ```bash
  # terminal 1 — the app (seeded + protected)
  STORE=memory SEED=1 BASIC_AUTH_USER=ticash BASIC_AUTH_PASS=demo2026 npm run dev
  # terminal 2 — the tunnel
  ./tools/cloudflared.exe tunnel --url http://localhost:3000
  ```

Use this for a "look at it right now" moment. For the proposal, send the Render link below.

---

## B. Permanent hosted URL — Render (free)

Gives a stable `https://ticash-pay-demo.onrender.com` that survives your PC being off.
Free plan sleeps after ~15 min idle (≈30 s cold start) — fine for a demo.

### One-time prep
1. Put this `ticash-pay` folder in a **GitHub repo** (private is fine):
   ```bash
   cd ticash-pay
   git init && git add . && git commit -m "Ticash Pay — Phase 1"
   # create a repo on github.com, then:
   git remote add origin https://github.com/<you>/ticash-pay.git
   git push -u origin main
   ```

### Deploy (dashboard — most reliable)
2. Go to https://render.com → sign up (free) → **New → Web Service**.
3. Connect your GitHub and pick the repo.
4. Settings:
   - **Language / Runtime:** Docker (it auto-detects the `Dockerfile`)
   - **Root Directory:** leave blank if the repo root is `ticash-pay`; otherwise set `ticash-pay`
   - **Plan:** Free
   - **Health Check Path:** `/health`
5. **Environment variables** (Advanced → Add):
   | Key | Value |
   |-----|-------|
   | `STORE` | `memory` |
   | `SEED` | `1` |
   | `HOST` | `0.0.0.0` |
   | `BASIC_AUTH_USER` | `ticash` |
   | `BASIC_AUTH_PASS` | *(choose a password)* |
   *(You don't set `PORT` — Render injects it and the app reads it.)*
6. **Create Web Service** → wait for the build → you get a public URL.
7. Open `https://<your-app>.onrender.com/admin` and log in. Send that link + the
   login to the client.

### Or: one-click Blueprint
This folder includes `render.yaml`. In Render: **New → Blueprint**, pick the repo, and
it provisions the service from that file. Set `BASIC_AUTH_PASS` when prompted.

---

## Switching the deployed demo to persistent Postgres (optional, later)

The demo runs in-memory (data resets on redeploy/restart). To persist data:
1. Render → **New → PostgreSQL** (free) → copy its Internal Database URL.
2. On the web service, set `DATABASE_URL` to it and **remove** `STORE=memory`.
3. Run the migration once (Render Shell): `node dist/db/migrate.js`.
   (Or add it to the start command: `node dist/db/migrate.js && node dist/api/server.js`.)

---

## Security note

The whole panel is behind HTTP Basic auth, served over HTTPS by the tunnel/Render — fine
for a client demo. It is **not** production-grade auth (no user accounts, sessions, or
rate-limited login). Real auth + RBAC is Phase 2/3 scope. Don't put real customer data
into the public demo.
