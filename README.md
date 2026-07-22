# FinClause — run it locally (Google AI Studio / Gemini edition)

A small full-stack version of FinClause: a Node/Express backend that keeps your
Google AI Studio (Gemini) API key safe on the server, plus the frontend you've
been testing, now talking to that backend instead of the Claude.ai artifact APIs.

Google AI Studio gives you a **free API key with no credit card**, so this is a
good option if you want to run the whole app at no cost.

## Folder structure

```
finclause/
├── backend/
│   ├── server.js         # Express backend (auth, storage, AI proxy)
│   ├── package.json
│   ├── .env.example       # copy this to .env and fill in your API key
│   └── db.json            # created automatically on first run — your local "database"
├── frontend/
│   └── index.html         # the frontend
└── README.md
```

## How it works

- **Auth**: real accounts, hashed passwords (bcrypt), JWT sessions. Stored in `backend/db.json`.
- **Storage**: your documents/budgets/chats/reports are saved to `backend/db.json` on
  disk, so they survive server restarts — a real upgrade over the browser-only
  storage the artifact version used.
- **AI features**: the frontend never talks to Google directly. It calls your
  own backend at `/api/ai/complete`, which holds the actual `GEMINI_API_KEY`
  and forwards the request to Google's Gemini API. This is the only way to use
  AI features safely outside the Claude.ai artifact — an API key can never live
  in browser JavaScript.
- The backend serves the frontend too (`backend/server.js` points at `../frontend`),
  so one running server gives you the whole site at `http://localhost:3000`.

`db.json` is a flat JSON file — perfectly fine for personal/local use or a small
number of users. If you ever deploy this for real multi-user traffic, swap the
`loadDb`/`saveDb` functions in `server.js` for a real database (Postgres, SQLite,
etc.) — the rest of the app doesn't need to change.

## Setup

**1. Requirements:** Node.js 18 or later (for built-in `fetch`).

**2. Go into the backend folder and install dependencies:**
```bash
cd backend
npm install
```

**3. Get a free Gemini API key:**
- Go to https://aistudio.google.com/apikey
- Sign in with a Google account and click "Create API key" — no credit card required.

**4. Configure your API key:**
```bash
cp .env.example .env
```
Then open `.env` and paste your key:
```
GEMINI_API_KEY=your-real-key-here
```
Also change `JWT_SECRET` to any random string of your own.

**5. Start the server (from inside `backend/`):**
```bash
npm start
```

**6. Open the app:**
```
http://localhost:3000
```

That's it — sign up, upload a document, and everything (analysis, chat, budget
advice) now runs through your own backend and your own free Gemini API key.

## Notes on the free tier

- The default model is `gemini-flash-latest` — an alias Google keeps pointed at
  whatever their current default Flash model is (currently `gemini-3.5-flash`,
  as of July 2026), and it sits on the free tier (no billing needed). Google
  deprecates specific dated model strings every few months (this project
  originally shipped with `gemini-2.5-flash`, which Google shut down in June
  2026), so the `-latest` alias is meant to save you from having to keep
  editing `.env` every time that happens. If Google ever retires the alias
  itself, check https://ai.google.dev/gemini-api/docs/models for its current
  replacement.
- Free tier requests are rate-limited (requests per minute/day) — if you hit a
  rate-limit error, wait a bit or switch `GEMINI_MODEL` in `.env` to
  `gemini-3.1-flash-lite`, which has a more generous free quota.
- Gemini's Pro-series models (e.g. `gemini-3.1-pro`) are paid-only as of 2026,
  so avoid setting `GEMINI_MODEL` to a Pro model unless you've enabled billing.
- On the free tier, Google may use your prompts/outputs to improve their
  products — don't send sensitive documents through the free tier if that
  matters to you. Attaching a billing account to your Google AI Studio project
  removes this and raises your quota, while `gemini-2.5-flash` itself stays cheap.
- Check https://ai.google.dev/gemini-api/docs/models and your Google AI Studio
  dashboard for the current free-tier model list and live rate limits — these
  change over time.
- Your data lives in `backend/db.json`. Back it up if you care about it; delete
  it to start completely fresh.
- The `frontend/` folder is plain static HTML — you could technically open
  `frontend/index.html` directly in a browser, but the AI features and login
  will not work that way, since they depend on the backend server running and
  serving it. Always access the app through `http://localhost:3000`, not by
  double-clicking the HTML file.
- This is a local/personal-use setup, not a hardened production deployment —
  there's no HTTPS, rate limiting, or email verification. Fine for running on
  your own machine; you'd want more before exposing this to the internet.
