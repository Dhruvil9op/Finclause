require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const DB_PATH = path.join(__dirname, 'db.json');

if (!GEMINI_API_KEY) {
  console.warn('\n⚠️  GEMINI_API_KEY is not set in .env — AI features (analysis, chat, budget advice) will fail until you add it and restart.\n   Get a free key (no credit card needed) at https://aistudio.google.com/apikey\n');
}
if (JWT_SECRET === 'dev-secret-change-me') {
  console.warn('⚠️  Using the default JWT_SECRET. Fine for local testing, but set your own random string in .env before sharing this beyond your machine.\n');
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

/* =====================================================================
   Tiny JSON-file "database"
   Good enough for local/personal use. Swap this module out for a real
   database (Postgres, etc.) if you deploy this for multiple real users.
===================================================================== */
function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: {}, state: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    console.error('db.json is corrupted — starting from an empty database.', e);
    return { users: {}, state: {} };
  }
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
const emptyState = () => ({ documents: [], budgets: [], chats: {}, reports: [] });

/* =====================================================================
   Auth middleware
===================================================================== */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userEmail = payload.email;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Your session expired — please log in again.' });
  }
}

/* =====================================================================
   Auth routes
===================================================================== */
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const db = loadDb();
  const key = String(email).trim().toLowerCase();
  if (db.users[key]) return res.status(409).json({ error: 'An account with this email already exists — try logging in instead.' });
  const passwordHash = bcrypt.hashSync(password, 10);
  db.users[key] = { name: (name && name.trim()) || key.split('@')[0], email: key, passwordHash };
  db.state[key] = emptyState();
  saveDb(db);
  const token = jwt.sign({ email: key }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { name: db.users[key].name, email: key } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const db = loadDb();
  const key = String(email).trim().toLowerCase();
  const user = db.users[key];
  if (!user) return res.status(404).json({ error: 'No account found for that email. Check the address or sign up instead.' });
  if (!bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ error: 'Incorrect password. Please try again.' });
  const token = jwt.sign({ email: key }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { name: user.name, email: key } });
});

/* =====================================================================
   State sync — simple whole-blob persistence.
   The frontend keeps one JSON object (documents/budgets/chats/reports)
   in memory and pushes the whole thing here after each change. Simple,
   reliable, and plenty fast at local/personal scale.
===================================================================== */
app.get('/api/state', authMiddleware, (req, res) => {
  const db = loadDb();
  res.json(db.state[req.userEmail] || emptyState());
});
app.put('/api/state', authMiddleware, (req, res) => {
  const db = loadDb();
  db.state[req.userEmail] = req.body && typeof req.body === 'object' ? req.body : emptyState();
  saveDb(db);
  res.json({ ok: true });
});

/* =====================================================================
   AI proxy — the ONLY place the Gemini API key is used.
   Keeping this server-side is the whole reason this backend exists:
   an API key can never live safely in browser JavaScript.

   Uses Google AI Studio's free-tier Gemini API. Get a key (no credit
   card needed) at https://aistudio.google.com/apikey
===================================================================== */
app.post('/api/ai/complete', authMiddleware, async (req, res) => {
  const { system, prompt, maxTokens } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt.' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY — add it to your .env file and restart the server.' });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
    const requestedTokens = maxTokens || 4096;
    const buildBody = (withThinkingConfig) => JSON.stringify({
      ...(system ? { systemInstruction: { role: 'system', parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        // Newer Gemini models "think" before answering, and those hidden
        // reasoning tokens are deducted from maxOutputTokens too — with a
        // small budget like 1500 the thinking alone can use it all up,
        // leaving zero tokens for the actual answer (finishReason:
        // MAX_TOKENS with empty text). thinkingBudget:0 turns thinking off
        // where the model allows it; the token headroom below is a
        // fallback for models that always spend a little on thinking
        // regardless of this setting.
        maxOutputTokens: requestedTokens + 2048,
        ...(withThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });

    let r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildBody(true),
    });
    let data = await r.json();
    // Some models (e.g. reasoning-only variants) reject thinkingBudget:0 outright.
    // Retry once without it rather than failing the whole request.
    if (data.error && /thinking/i.test(data.error.message || '')) {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildBody(false),
      });
      data = await r.json();
    }
    if (data.error) return res.status(502).json({ error: data.error.message || 'Gemini API returned an error.' });

    const candidate = (data.candidates || [])[0];
    if (!candidate) {
      // Most common cause: the prompt or expected output tripped a safety filter.
      const blockReason = data.promptFeedback && data.promptFeedback.blockReason;
      return res.status(502).json({ error: blockReason ? `Gemini blocked this request (${blockReason}).` : 'Gemini API returned no response.' });
    }
    const text = ((candidate.content && candidate.content.parts) || []).map(p => p.text || '').join('\n');
    // Normalize Gemini's finishReason to the 'max_tokens' value the frontend checks for.
    const finish = candidate.finishReason;
    const stop_reason = finish === 'MAX_TOKENS' ? 'max_tokens' : finish;
    res.json({ text, stop_reason });
  } catch (err) {
    console.error('Gemini API call failed:', err);
    res.status(502).json({ error: 'Could not reach the Gemini API. Check your internet connection and API key.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ FinClause is running at http://localhost:${PORT}\n`);
});
