# SAHAYAK — WhatsApp Medicine Care & Family Check-in System

A local prototype web app that reminds patients to take their medicines over WhatsApp and alerts family members when a dose is reported NOT TAKEN or when the patient does not respond.

> ⚠️ **This is a prototype for demonstration and learning.** It is not a certified medical device, not an emergency monitoring service, and not production/legally compliant software. Delivery depends on WhatsApp and network availability. A `NO_RESPONSE` status means "not confirmed", never "medically verified missed dose".

---

## 1. What you need installed first

| Software | Version | Where to get it |
|---|---|---|
| Node.js | **22 or newer** (required — the app uses Node's built-in SQLite) | https://nodejs.org (choose "LTS") |
| VS Code | any recent version | https://code.visualstudio.com |
| Git (optional) | any | https://git-scm.com |

Check Node in PowerShell:

```powershell
node --version
```

You should see something like `v22.11.0`. If you see an error or a version below 22, install Node 22 LTS first.

No build tools, no Docker, no database server, no paid services are needed. There are **zero native dependencies** — everything installs cleanly on Windows.

---

## 2. Open the project in VS Code

1. Unzip `sahayak.zip` to a folder, e.g. `C:\Users\you\Projects\sahayak`.
2. Open VS Code → **File → Open Folder…** → select the `sahayak` folder.
3. Open the built-in terminal: **Terminal → New Terminal** (or press Ctrl+`).

---

## 3. Install dependencies (one-time)

In the VS Code terminal (PowerShell), from the `sahayak` folder:

```powershell
npm run setup
```

What this does: installs the backend packages (`server/`) and the frontend packages (`client/`). Successful output ends with `added … packages` twice and **no red errors**.

---

## 4. How the database is created

You do nothing. On the first backend start, the app automatically:

- Creates the SQLite database file at `database/sahayak.db`.
- Applies the full schema (tables, foreign keys, indexes).
- Creates the admin login from `server/.env` (see next section).
- Seeds clearly-labelled fictional demo data ("(SAMPLE)" names) **only if the database is empty** — it never overwrites your real local records on a restart.

---

## 5. Configure the demo admin securely

```powershell
Copy-Item .env.example server\.env
```

Then open `server\.env` in VS Code and set:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=sahayak123
```

**Change the password to something you choose** before demonstrating. This file is in `.gitignore`, so it will never be committed to Git. Never paste secrets into source code.

---

## 6. Start the backend and the frontend

Open **two** terminals in VS Code (Terminal → New Terminal twice; each has a + tab).

Terminal 1 — backend (port 4000):

```powershell
npm run dev:server
```

Successful output looks like:

```
[auth] created admin "admin" (password from server/.env)
[seed] demo sample data created (2 patients, 3 family members, 3 schedules, example history)
[scheduler] started, polling every 10000 ms
[sahayak] backend listening on http://localhost:4000
```

Terminal 2 — frontend (port 5173):

```powershell
npm run dev:client
```

Successful output ends with:

```
VITE ready in ... ms
➜  Local:   http://localhost:5173/
```

---

## 7. Log in

Open **http://localhost:5173** in your browser and log in with the username/password from `server\.env` (default `admin` / `sahayak123`).

You will see the badge **DEMO mode** in the sidebar. Demo mode works with zero external credentials: messages are simulated and displayed in the dashboard/history, and nothing is sent to a real phone.

---

## 8. Add a patient and a family member

1. **Patients** page → **+ Add patient** → enter full name, phone *with country code* (e.g. `+919812345678`), time zone, optionally tick family members → **Add patient**.
2. **Family Members** page → **+ Add family member** → name, WhatsApp phone with country code, optional relationship → tick the patients they should receive alerts for → **Add family member**.
3. You can also manage the same links from either side later (Edit → tick/untick), and activate/deactivate or remove with confirmation dialogs. Removing never erases notification/audit history.

---

## 9. Configure a medicine schedule

**Medicines & Schedules** page → **+ Add medicine schedule**:

- pick the patient, medicine name, dosage text,
- add one or more reminder times per day, tick the days of the week,
- start date (and optional end date), time zone,
- no-response timeout (default 30 minutes),
- which family members get alerts (empty = all linked active family),
- reminder message template.

The scheduler runs in the backend automatically — no code edits, no restarts needed after changes. Press **Send test dose** on any schedule to create a dose immediately for testing.

---

## 10. Test TAKEN and NOT_TAKEN

Each reminder contains two secure, single-use, expiring links (TAKEN / NOT TAKEN). In DEMO mode on your own computer, use the simulator instead of a phone:

1. On **Medicines & Schedules**, press **Send test dose** on a schedule.
2. Go to **Settings & Integrations** → *Patient-response simulator* → the dose is listed as *awaiting response*.
3. Press **TAKEN** → the dose is marked TAKEN, the pending family alert is cancelled, and **no** family alert is sent.
4. Press **NOT TAKEN** (on a fresh test dose) → all configured, authorised family members are alerted immediately.

You can also click the real TAKEN/NOT TAKEN links from the reminder record in **Reminder History** — they work in your browser on the same computer.

> **Why can't my phone open these links?** The links point at `localhost`, which only exists on your computer. To let a real phone open them you need a secure HTTPS tunnel (see section 15). In DEMO mode, use the simulator.

---

## 11. Test the 30-minute timeout (in 0 seconds — accelerated testing)

The real 30-minute timeout is enforced by the **backend**, and the deadline is stored in the database (it survives restarts). For testing, the simulator has a **Force timeout now** button:

1. Send a test dose (do NOT respond).
2. **Settings & Integrations** → *Patient-response simulator* → **Force timeout now**.
3. The dose becomes `NO_RESPONSE` (labelled UNCONFIRMED — not a verified missed dose) and all linked family members receive the NO_RESPONSE alert immediately. The default production timeout stays 30 minutes.

If the patient responds *after* the alert, the late response is recorded while the earlier alert remains in the history.

---

## 12. Automated tests

```powershell
npm test
```

All tests run against a fresh in-memory database. Expected output:

```
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

Covered: login/auth, patient & family CRUD + duplicate rejection, linking/unlinking, schedule validation, dose generation, TAKEN cancelling alerts, NOT_TAKEN alerting, NO_RESPONSE after timeout, late-response history preservation, invalid/reused tokens, duplicate webhooks, scheduler recovery after restart, and demo mode never claiming a real send.

---

## 13. Configure official WhatsApp (LIVE mode) — optional

Until you do this, stay in DEMO mode — everything works.

1. Create a Meta developer account at https://developers.facebook.com → **My Apps → Create App → Business**.
2. Add the **WhatsApp** product. The dashboard gives you a temporary access token, a **Phone number ID**, and a test number.
3. Edit `server\.env` and fill in:

```
WHATSAPP_ACCESS_TOKEN=EAAG...       (from the dashboard; use a permanent token for anything long-running)
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_GRAPH_API_VERSION=v22.0
WHATSAPP_WEBHOOK_VERIFY_TOKEN=any-random-string-you-invent
WHATSAPP_APP_SECRET=...             (App settings → Basic)
```

4. Restart the backend. The sidebar now shows **LIVE mode**. Test with **Settings → Test connection** and **Send test message** (both require your explicit confirmation).

**Important Meta rules the app enforces:**
- Free-form messages are only allowed **within 24 hours** of the recipient's last incoming message. Outside that window the app refuses to send free-form text (it fails safely with an explanation — it never fakes a success). Outgoing reminders in live mode should use **approved WhatsApp message templates** created in your Meta Business dashboard; template approval status is managed there, not in SAHAYAK.

---

## 14. Configure Meta webhooks (for patient replies over real WhatsApp)

The backend exposes:

- `GET /api/webhook` — Meta verification (`hub.challenge`).
- `POST /api/webhook` — inbound messages (a patient replying **TAKEN** / **NOT TAKEN** is matched to their newest awaiting dose) and delivery/read/failed status updates. Every event id is stored once, so duplicate webhook deliveries can't double-alert. Payloads are verified with `X-Hub-Signature-256` (HMAC-SHA256 with your app secret).

Meta requires a **public HTTPS URL**, so for local development you need a tunnel, e.g. [ngrok](https://ngrok.com):

```powershell
ngrok http 4000
```

Copy the `https://….ngrok.app` URL, then in Meta's app dashboard: **WhatsApp → Configuration → Webhook → Edit**:
- Callback URL: `https://….ngrok.app/api/webhook`
- Verify token: the exact value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN` from `server\.env`

Also put the same tunnel URL into `PUBLIC_BASE_URL` in `server\.env` (restart afterwards) so the TAKEN/NOT TAKEN links in reminders use it. Limitations: tunnel URLs change on the free plan, and the tunnel must be running whenever you expect replies.

---

## 15. Troubleshooting

| Problem | Fix |
|---|---|
| `node --version` below 22 | Install Node 22 LTS from nodejs.org, reopen the terminal. |
| `npm run setup` fails | Check your internet; delete `server\node_modules` and `client\node_modules` and retry. |
| Login says "Invalid username or password" | Check `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `server\.env`; restart the backend after edits. Note: the admin account is created on first start — to change an existing password, delete `database\sahayak.db` (demo only) or edit the row. |
| `EADDRINUSE :4000` | Another process uses port 4000. Change `PORT` in `server\.env` and update the proxy in `client\vite.config.js`. |
| Frontend shows "Not logged in" repeatedly | The backend isn't running — check Terminal 1. |
| Time shows odd hours | Timestamps are stored in UTC and displayed in your browser's locale; schedule times use each schedule's own time zone. |
| WhatsApp test message fails in LIVE mode | Read the exact API error shown on screen; check token expiry (dashboard tokens expire after 24 h) and the 24-hour window rules. |

---

## 16. Stop, restart, and data

- Stop each terminal with **Ctrl+C** (or close VS Code).
- Start again any time with the two commands from section 6. **All data is kept** — it lives in `database\sahayak.db`, and the scheduler recovers pending jobs from the database on restart.
- Reset to fresh sample data (deletes local records — demo only):
  ```powershell
  npm run seed:reset
  ```

---

## Project structure

```
sahayak/
  client/                 React + Vite dashboard (7 pages)
  server/
    src/
      index.js            server bootstrap
      schema.sql          full database schema
      db.js               SQLite (node:sqlite) + transactions
      config.js           env configuration
      auth.js             login, sessions, scrypt hashing, rate limiting
      routes.js           all REST API endpoints + webhook
      workflow.js         doses, reminders, TAKEN/NOT_TAKEN/timeout, scheduler
      whatsapp.js         Cloud API integration + DEMO simulation
      templates           (message templates live in the DB, editable in the UI)
      seed.js             fictional sample data
    tests/                Vitest + supertest suite (18 tests)
  database/               sahayak.db (created at first run)
  docs/                   WhatsApp live-setup guide, architecture notes
  .env.example            every setting explained
```

## Key design choices (in plain language)

- **SQLite via Node's built-in module** — zero native compilation, so `npm install` works on any machine with Node 22.
- **DB-polling scheduler** — every dose and its 30-minute deadline are *rows in the database*, so a restart neither loses jobs nor duplicates them. The frontend never controls timing.
- **Idempotency** — `doses` has a unique key per (schedule, time); family alerts have a partial-unique index per (dose, kind, family); response tokens are single-use and expiring; webhook event ids are stored once.
- **Demo/Live split** — DEMO messages are recorded as `simulated`, never `sent`. LIVE failures surface as real errors.
