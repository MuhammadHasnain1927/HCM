# HCM Lite

AI-assisted Human Capital Management for Admin, HR and Employees — built for the Saylani Hackathon (24 Oct 2026).

The system starts **empty**: Admin sets up the company, HR registers employees, and every number on the dashboards and every AI answer comes from what people do in the app. There is no dummy data.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite, React Router, Tailwind CSS, Axios |
| Backend | Node.js 20+, Express 5, Mongoose |
| Database | MongoDB Atlas |
| Auth | JWT (Bearer) + bcrypt password hashes |
| AI | Google Gemini (primary) with Groq fallback, tool calling, server-side only |
| Tests | Vitest, Supertest, mongodb-memory-server |

```
HCM/
├── client/   React app (deploy to Vercel)
└── server/   Express API (deploy to Render)
    └── src/  routes → services (business rules) → models
```

## Run it locally (about 5 minutes)

1. **Install** (Node.js 20 or newer):

   ```bash
   npm run install:all
   ```

2. **Create the server env file**: copy `server/.env.example` to `server/.env` and fill in:
   - `MONGODB_URI` — your Atlas connection string (see below)
   - `JWT_SECRET` — any random string of 32+ characters. Generate one:

     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```

3. **Start both apps**:

   ```bash
   npm run dev
   ```

   API: http://localhost:5000/api/health · App: http://localhost:5173

4. Open the app. A fresh database shows the **first-run setup** screen.

## MongoDB Atlas setup

1. Sign in at https://cloud.mongodb.com and create a free **M0** cluster.
2. **Database Access** → Add database user → username + generated password, role "Read and write to any database".
3. **Network Access** → Add IP address → `0.0.0.0/0` (needed for Render, whose IP changes) or your own IP for local only.
4. **Connect** → Drivers → copy the `mongodb+srv://...` string. Put the password in it and add the database name `hcm-lite` before the `?`:

   ```
   mongodb+srv://hcm_app:<password>@cluster0.xxxxx.mongodb.net/hcm-lite?retryWrites=true&w=majority
   ```

5. Paste it as `MONGODB_URI` in `server/.env`. Collections are created automatically on first use.

## Creating the first Admin

Either:

- **Setup screen (default):** open the app on an empty database and fill in the company name and the Admin account. This only works once.
- **From env:** set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `ADMIN_NAME`, `COMPANY_NAME`) in `server/.env`. On start, if no company exists yet, the server creates it and the Admin.

Admin then creates HR logins; HR registering an employee creates that employee's login with a temporary password that must be changed on first sign-in.

## AI keys

Set `GEMINI_API_KEY` (https://aistudio.google.com/apikey) and `GROQ_API_KEY` (https://console.groq.com/keys) in `server/.env` or in the hosting provider's environment settings. Keys stay on the server; the browser never calls an AI provider.

## Tests

```bash
npm test
```

Tests need a database they are allowed to wipe:

- Set `TEST_MONGODB_URI` in `server/.env` to a separate Atlas database whose name ends in `-test` (e.g. `.../hcm-lite-test?...`). The tests refuse to run against any other database name.
- Or leave it empty: the tests start a temporary in-memory MongoDB (the first run downloads a MongoDB binary of about 500 MB).

## Deployment

**Backend → Render** (Web Service): root directory `server`, build `npm install`, start `npm start`. Environment: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, `CLIENT_URL=https://<your-app>.vercel.app`, AI keys.

**Frontend → Vercel**: root directory `client`, framework Vite. Environment: `VITE_API_URL=https://<your-api>.onrender.com/api`.

Only `.env.example` files are committed. Real secrets live in the hosting provider's environment settings.

## Security

- Every API request is checked on the server: valid JWT, active account, role, and data scope (an Employee only reads rows with their own employee id).
- Passwords are bcrypt-hashed (12 rounds); login errors never reveal whether an email exists; login is rate-limited.
- Changing or resetting a password, or deactivating an account, immediately invalidates old sessions.
- New accounts must change their temporary password before using anything else.
- The audit log is insert-only: entries cannot be updated or deleted.
- Helmet security headers, CORS limited to `CLIENT_URL`, MongoDB query-injection filter, 1 MB body limit.

## Progress

| # | Functionality | Status |
| --- | --- | --- |
| 01 | First-run setup: company profile and Admin account | Done |
| 02 | Login, logout, change password; role-based menus | Done |
| 03–25 | Organization, employees, attendance, leave, payroll, dashboards, AI, comms | In progress |
