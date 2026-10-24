# HCM Lite

AI-assisted Human Capital Management for **Admin, HR and Employees**, built for the Saylani Hackathon (24 Oct 2026).

The system starts **empty**: Admin sets up the company, HR registers employees, and every number on the dashboards and every AI answer comes from what people do in the app. There is no dummy or pre-loaded data.

- **Live app:** https://hcm-lite-five.vercel.app
- **Live API:** https://hcm-lite-api-one.vercel.app/api/health
- **Repository:** https://github.com/MuhammadHasnain1927/HCM

## What it does

| Module | Highlights |
| --- | --- |
| M1 Auth & Access | JWT login, bcrypt (12 rounds), 3 roles, role + data-scope check on **every** API call, forced change of temporary passwords, sessions revoked on password change/reset/deactivation |
| M2 Organization | Company settings (office hours, grace, half-day threshold, weekend, timezone, office location + radius), departments, designations, leave types + quotas, public holidays, HR logins |
| M3 Employees | Admin or HR registers (creates the login, optional Face ID photo), directory with server-side search/filters/paging, Employee 360, salary structure, exit/reinstate, CSV import with dry run (row + field + reason), CSV export |
| M4 Attendance | Web check-in/out stamped by the server, present / late / half day / missing checkout / absent / on leave, month calendar, daily board, corrections (request → HR approves) |
| M5 Leave | Working days only (weekends + holidays skipped), quotas, balance, overlap and over-balance → 422, approval inbox with comments, cancel |
| M6 Payroll Lite | Gross = 1.5 × basic, per-day deductions, proration for joiners/leavers, tax slabs, HR drafts → Admin finalizes → locked (423), payslip PDF |
| M7 Dashboards | Admin / HR / Employee dashboards, all numbers computed on the server, filters by date range and department |
| M8 AI Assistant | Chat with tools, dashboard summary, smart leave, policy Q&A, Gemini with automatic Groq fallback |
| M9 Comms & Audit | Announcements, in-app notifications, insert-only audit log with before/after |

**Bonus:** Face ID attendance (enrolled face + blink liveness + AI face match + office geofence, web), late penalty rule (3 lates = 0.5 day, toggle), absence anomaly flags, attrition risk score, Roman Urdu answers, dark mode, installable PWA.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite, React Router, Tailwind CSS 4, Recharts, Axios, `@vladmandic/face-api` (camera check-in) |
| Backend | Node.js 20+, Express 5, Mongoose 9, Zod, pdfkit, geolib, csv-parse |
| Database | MongoDB Atlas |
| AI | Google Gemini (`gemini-3.5-flash`, falls back to Flash-Lite) → Groq (`openai/gpt-oss-120b`) with tool calling |
| Tests | Vitest + Supertest (80 tests) |

```
HCM/
├── client/                 React app (Vercel)
└── server/                 Express API (Vercel serverless via server/api/index.js, or any Node host)
    └── src/
        ├── routes/         HTTP + validation + role guards
        ├── services/       business rules (attendance, leave, payroll, analytics, ai/)
        ├── models/         Mongoose schemas
        └── middleware/     auth (role + data scope), errors, validation
```

## Run it locally (about 5 minutes)

1. **Install** (Node.js 20 or newer):

   ```bash
   npm run install:all
   ```

2. **Configure the server:** copy `server/.env.example` to `server/.env` and set:
   - `MONGODB_URI`: your Atlas connection string ([steps below](#mongodb-atlas-setup))
   - `JWT_SECRET`: any random string of 32+ characters. Generate one:

     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```

   - `GEMINI_API_KEY` and/or `GROQ_API_KEY` ([AI keys](#ai-keys))

3. **Start both apps:**

   ```bash
   npm run dev
   ```

   App: http://localhost:5173 · API health: http://localhost:5000/api/health

4. Open the app. A fresh database shows the **first-run setup** screen.

## Creating the first Admin

- **Setup screen (default):** on an empty database the app asks for the company name, timezone and the Admin account. This works only once.
- **From env:** set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (optional `ADMIN_NAME`, `COMPANY_NAME`) in `server/.env`. On start, if no Admin exists yet, the server creates the company and the Admin.

Then: Admin creates HR logins (User accounts) → HR registers employees (each gets a temporary password that must be changed at first sign-in). If HR registers themselves as an employee with the same email, their HR login is linked to the record so they can check in too.

## MongoDB Atlas setup

1. Create a free **M0** cluster at https://cloud.mongodb.com.
2. **Database Access** → Add user (e.g. `hcm_app`) with *Specific privileges*: `readWrite` on `hcm-lite` (and `hcm-lite-test` for tests).
3. **Network Access** → add your IP for local work, and `0.0.0.0/0` for Vercel/Render (their IPs change).
4. **Connect → Drivers**: copy the `mongodb+srv://` string, insert the password and add the database name before the `?`:

   ```
   mongodb+srv://hcm_app:<password>@<cluster-host>/hcm-lite?retryWrites=true&w=majority
   ```

## AI keys

| Provider | Key | Get it |
| --- | --- | --- |
| Gemini (primary) | `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| Groq (fallback) | `GROQ_API_KEY` | https://console.groq.com/keys |

Keys live only in the server environment; the browser never calls an AI provider. Optional `GEMINI_MODEL` / `GROQ_MODEL` override the defaults. If Gemini is out of quota, overloaded or slow, the request automatically moves to the next Gemini model and then to Groq.

**How the assistant works:** chat → `POST /api/ai/chat` → the model picks a tool (`get_headcount`, `get_attendance_summary`, `get_late_comers`, `get_leave_summary`, `get_my_leave_balance`, `get_payroll_summary`, `search_employees`) → the server runs it **with the signed-in user's access** using the same services as the REST API → the model writes the answer. Guardrails: 15 s timeout with a friendly fallback, ~20 requests per user per hour, every call logged in `ai_logs`, answers labelled *AI-generated*, JSON output validated with one retry. Employees only get self-service tools and the services refuse anything else, so "What is my colleague's salary?" is politely refused.

## Business rules (from the brief)

- **Attendance:** office 09:00, grace 15 min → late after 09:15; under 5 h worked = half day; no check-out = missing checkout; no record and no approved leave on a working day = absent. One record per employee per day (second check-in → 409). All rules use the company timezone, not the server's.
- **Leave:** working days only; quotas annual 14, sick 8, casual 10, unpaid unlimited; overlap or over-balance → 422.
- **Payroll:** gross = 1.5 × basic (HRA 40 %, medical 10 %); per day = gross ÷ working days; deductions = absent + unpaid + 0.5 × half days; joiners/leavers prorated; tax slab on gross × 12 (0 to 600k; 5 % to 1.2M; 30k + 15 % to 2.4M; 210k + 25 % to 3.6M; 510k + 35 % above); only Admin finalizes; finalized runs are locked.
- **Metrics:** attendance rate = (present + late + missing checkout + 0.5 × half day) ÷ (working-day records − on leave); late % = late ÷ (present + late); absenteeism = absent ÷ expected working days; leave utilization = approved ÷ quota; attrition = exits ÷ average headcount × 100.

## 5-minute demo script

1. Fresh install → Admin completes setup → **Organization**: office hours, location (Use my current location), a department + designation, review leave types → **User accounts**: Add HR login.
2. HR signs in (temporary password → new password) → **Employees → Register employee** (2–3 people) → one employee signs in, changes the password and **checks in** on the dashboard.
3. Employee → **Leave** → Smart leave: *"I need next Monday and Tuesday off for my sister's wedding"* → confirm the pre-filled form → HR → **Leave → Approvals** → Approve.
4. HR **Dashboard → Summarize**, then **Ask AI**: *"Who is on leave tomorrow?"* → **Payroll → Run payroll** → Admin opens the run → **Finalize**.
5. Employee → **My payslips** → PDF; **Ask AI**: *"What is <colleague>'s salary?"* (refused) → Admin → **Audit log**.

## Face ID attendance

1. **Enroll:** after registering an employee, HR/Admin clicks **Capture face** (camera, or upload a clear photo). If skipped, the employee sets up Face ID once at their first check-in (camera + blink). After that only HR/Admin can re-enroll or reset it (Employee 360 → Face ID).
2. **Check in / out:** the camera waits for exactly one face and a blink (face-api landmarks), takes a photo and sends it with the GPS position. The server stamps the time, checks the office radius (when Admin has set one) and asks an AI vision model (Gemini, falling back to Groq) whether the live face matches the enrolled face, allowing for age, beard, glasses and lighting, and rejecting photos of screens or printed photos.
3. **Over time:** each verified photo is kept as a recent reference (last 3), so the profile follows slow changes in a person's face.
4. **Refusals:** a mismatch is refused (422) and HR is notified; if the AI is unavailable the employee is told to retry or request an attendance correction. Every check is logged in `ai_logs` (`face_verify`), at most 15 per user per hour.

## Tests

```bash
npm test
```

80 tests cover setup, auth, role guards and data scope, organization, employees + CSV, attendance and corrections, leave rules, payroll numbers (checked by hand against the brief), dashboards, AI (with a fake model: tools, fallback, privacy, smart leave, summary) and comms/audit.

Tests need a database they may wipe: set `TEST_MONGODB_URI` in `server/.env` to a database whose name ends in `-test` (they refuse anything else), or leave it empty to use an in-memory MongoDB (first run downloads ~500 MB). To check the real AI providers with the judges' questions: `LIVE_AI=1 npx vitest run tests/live-ai.test.js` (in `server/`).

## Deployment

**Backend → Vercel** (current setup): project with root directory `server`, preset *Other*. `server/api/index.js` wraps the Express app as a serverless function and `server/vercel.json` routes every path to it.

**Backend → Render** (alternative, long-running server): root directory `server`, build `npm install`, start `npm start`, region close to your Atlas cluster.

Backend environment (either host):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas string (database `hcm-lite`) |
| `JWT_SECRET` | 32+ random characters |
| `CLIENT_URL` | the frontend's exact address, e.g. `https://hcm-lite-five.vercel.app` (CORS) |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | your keys |

**Frontend → Vercel:** root directory `client`, framework Vite, environment `VITE_API_URL=https://<your-api-domain>/api`. `client/vercel.json` already rewrites routes to the SPA.

Only `.env.example` files are committed; real secrets go in the hosting providers' environment settings. Before submitting, start from an **empty database** so judges see first-run setup.

## Security

- Server-side role + data-scope checks on every request; employees can only read rows with their own employee id (also enforced for AI tools).
- bcrypt password hashes; login errors never reveal whether an email exists; failed sign-ins are rate-limited per account + IP.
- Temporary passwords must be changed before anything else; password change/reset/deactivation revokes old sessions. HR cannot change their own salary or job record.
- Insert-only audit log (create, update, approve, finalize, downloads) with before/after snapshots and no secrets.
- Helmet headers, CORS limited to `CLIENT_URL`, Mongo query-injection filter, request validation with Zod, 1 MB body limit, AI key only on the server.
- Face ID stores one reference photo per employee plus the last 3 verified check-in photos (separate collection, never in lists or exports), visible only to HR, Admin and the employee; users are told this on the enrollment screen. Admin can switch Face ID off in Organization → Company settings.

## Done / not done

| Item | Status |
| --- | --- |
| All 25 functionalities in the brief's checklist | Done |
| Camera check-in (face detection + geofence, web) | Done (bonus) |
| Late penalty, absence anomalies, attrition risk, Roman Urdu, dark mode, PWA | Done (bonus) |
| Face *matching* to an enrolled face + blink liveness | Done (extra bonus): AI vision match, see below |
| Native mobile app | Not done (optional; camera check-in works in the mobile browser) |
