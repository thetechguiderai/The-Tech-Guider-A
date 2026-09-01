// server.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

// ---------- DATABASE ----------
const db = new DatabaseSync(process.env.DATABASE_PATH || path.join(__dirname, "tech-guider.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'user',
  plan TEXT DEFAULT 'free',
  credits INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  model TEXT,
  day TEXT,
  count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  model TEXT,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT DEFAULT 'New Chat',
  model TEXT DEFAULT 'guider-flash',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT,
  amount INTEGER,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, user_id)
);
CREATE TABLE IF NOT EXISTS owner_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS owner_model_settings (model_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, tier TEXT, daily_limit INTEGER);
CREATE TABLE IF NOT EXISTS owner_plan_settings (plan_id TEXT PRIMARY KEY, monthly INTEGER, yearly INTEGER, enabled INTEGER NOT NULL DEFAULT 1, daily_limit INTEGER, features TEXT);
CREATE TABLE IF NOT EXISTS owner_audit_log (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS owner_assistant_messages (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
`);
// Non-destructive migration for accounts created through Google OAuth.
for (const statement of [
  "ALTER TABLE users ADD COLUMN oauth_provider TEXT",
  "ALTER TABLE users ADD COLUMN oauth_subject TEXT",
  "ALTER TABLE users ADD COLUMN two_factor_secret TEXT",
  "ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN trial_started_at TEXT",
  "ALTER TABLE users ADD COLUMN trial_expires_at TEXT",
  "ALTER TABLE users ADD COLUMN trial_claimed INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0",
  "ALTER TABLE conversations ADD COLUMN share_id TEXT",
]) {
  try { db.exec(statement); } catch { /* Column already exists. */ }
}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_identity ON users(oauth_provider, oauth_subject)"); } catch { /* Existing data can be repaired by an admin. */ }

// ---------- MODELS (Guider catalog) ----------
const VALID_OPENROUTER_FREE_MODEL = "meta-llama/llama-3.1-8b-instruct";
const MODELS = {
  "guider-flash":   { name: "Guider Flash",    tier: "free",  provider: "openrouter", model: VALID_OPENROUTER_FREE_MODEL, dailyLimit: 30, desc: "Fast everyday AI chat, normal questions, general assistance." },
  "guider-pro":      { name: "Guider Pro",      tier: "paid",  provider: "anthropic",  model: "claude-sonnet-4-6", dailyLimit: 0, desc: "Advanced chatting, coding, image generation. Unlimited usage." },
  "guider-go":       { name: "Guider Go",       tier: "paid",  provider: "openai",     model: "gpt-4.1", dailyLimit: 0, desc: "Coding, programming aur complete projects." },
  "guider-plus":     { name: "Guider Plus",     tier: "free",  provider: "google",     model: "gemini-1.5-flash", dailyLimit: 15, desc: "Web/resource finding, content research, logo/banner/design, social-media assistance." },
  "guider-plus-max": { name: "Guider Plus Max", tier: "paid",  provider: "google",     model: "gemini-1.5-pro", dailyLimit: 0, desc: "Heavy projects aur advanced Plus tasks." },
  "guider-offline":  { name: "Guider Offline",  tier: "guest", provider: "openrouter", model: VALID_OPENROUTER_FREE_MODEL, dailyLimit: 5, desc: "Limited AI functionality without full account access." },
  "guider-fast":     { name: "Guider Fast",     tier: "free",  provider: "openrouter", model: VALID_OPENROUTER_FREE_MODEL, dailyLimit: 30, desc: "Very fast everyday tasks." },
  "guider-gpt":      { name: "Guider GPT",      tier: "paid",  provider: "openai",     model: "gpt-4o", dailyLimit: 0, desc: "Premium all-rounder model for advanced general-purpose work." },
};

// ---------- PLANS (PKR pricing) ----------
const plan = (id, name, monthly, yearly, unlocks, desc) => ({ id, name, monthly, yearly, unlocks, desc });
const PLANS = [
  plan("free",     "Free",     0,    0,    [],                          "Get started with The Tech Guider AI."),
  plan("plus",     "Plus",     499,  999,  ["guider-plus"],             "Resource, content, and design assistance."),
  plan("plus_max", "Content",  999,  1999, ["guider-plus-max"],         "Heavy content and advanced Plus tasks."),
  plan("pro",      "Pro",      1999, 3999, ["guider-pro"],              "Advanced chat, coding, and image generation."),
  plan("gpt",      "Business", 2999, 5999, ["guider-gpt", "guider-go"], "Advanced general-purpose and project access."),
];
for (const [id, model] of Object.entries(MODELS)) {
  db.prepare("INSERT OR IGNORE INTO owner_model_settings (model_id, enabled, tier, daily_limit) VALUES (?, 1, ?, ?)").run(id, model.tier, model.dailyLimit);
}
for (const item of PLANS) {
  db.prepare("INSERT OR IGNORE INTO owner_plan_settings (plan_id, monthly, yearly, enabled, features) VALUES (?, ?, ?, 1, ?)")
    .run(item.id, item.monthly, item.yearly, JSON.stringify(item.unlocks));
}
db.prepare("INSERT OR IGNORE INTO owner_settings (key, value) VALUES ('maintenance', '0')").run();

function modelConfig(id) {
  const base = MODELS[id];
  if (!base) return null;
  const setting = db.prepare("SELECT * FROM owner_model_settings WHERE model_id = ?").get(id);
  return { ...base, enabled: setting ? Boolean(setting.enabled) : true, tier: setting?.tier || base.tier, dailyLimit: setting?.daily_limit ?? base.dailyLimit };
}
function planConfig(id) {
  const base = PLANS.find((item) => item.id === id);
  if (!base) return null;
  const setting = db.prepare("SELECT * FROM owner_plan_settings WHERE plan_id = ?").get(id);
  return { ...base, monthly: setting?.monthly ?? base.monthly, yearly: setting?.yearly ?? base.yearly, enabled: setting ? Boolean(setting.enabled) : true, dailyLimit: setting?.daily_limit ?? null, features: setting?.features ? JSON.parse(setting.features) : base.unlocks };
}
function planUnlocksModel(planId, modelId) {
  const plan = planConfig(planId);
  return Boolean(plan?.enabled && plan.features.includes(modelId));
}

// ---------- APP SETUP ----------
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
const publicDir = path.join(__dirname, "..", "Public");
app.get(["/owner", "/owner.html"], requireOwner, (req, res) => res.sendFile(path.join(publicDir, "owner-dashboard.html")));
app.use(express.static(publicDir));

// ---------- OWNER AUTO-SETUP ----------
(async function ensureOwner() {
  const email = (process.env.OWNER_EMAIL || "").toLowerCase().trim();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (existing) {
    if (existing.role !== "owner") db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(existing.id);
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO users (id, email, password_hash, name, role, plan) VALUES (?, ?, ?, 'Owner', 'owner', 'gpt')")
    .run(nanoid(), email, hash);
  console.log(`[boot] Owner account created: ${email}`);
})();

// ---------- AUTH HELPERS ----------
function signToken(user) { return jwt.sign({ sub: user.id }, SECRET, { expiresIn: "30d" }); }
function isSecureRequest(req) { return req.secure || req.get("x-forwarded-proto") === "https"; }
function setSession(res, req, user) {
  res.cookie("tg_session", signToken(user), { httpOnly: true, sameSite: "lax", secure: isSecureRequest(req), maxAge: 30 * 24 * 60 * 60 * 1000 });
}
function getUser(req) {
  const token = req.cookies?.tg_session;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  } catch { return null; }
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, credits: u.credits,
    trialExpiresAt: u.trial_expires_at || null,
    guiderGptTrialActive: hasGuiderGptTrial(u) };
}
function hasGuiderGptTrial(user) {
  return Boolean(user?.trial_expires_at && new Date(user.trial_expires_at).getTime() > Date.now());
}
function canUseModel(user, modelId) {
  const model = modelConfig(modelId);
  if (!model?.enabled) return false;
  if (!user) return false;
  return user.role === "owner" || planUnlocksModel(user.plan, modelId) || (modelId === "guider-gpt" && hasGuiderGptTrial(user));
}
function isConfiguredOwner(user) {
  const email = (process.env.OWNER_EMAIL || "").toLowerCase().trim();
  return Boolean(email && user?.role === "owner" && user.email.toLowerCase() === email);
}
function maintenanceEnabled() { return db.prepare("SELECT value FROM owner_settings WHERE key = 'maintenance'").get()?.value === "1"; }
function audit(ownerId, action, target = null, detail = null) {
  db.prepare("INSERT INTO owner_audit_log (id, owner_id, action, target, detail) VALUES (?, ?, ?, ?, ?)").run(nanoid(), ownerId, action, target, detail ? JSON.stringify(detail) : null);
}
function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Sign in required." });
  if (user.disabled) return res.status(403).json({ error: "This account has been disabled." });
  req.user = user;
  next();
}
function requireOwner(req, res, next) {
  const user = getUser(req);
  if (!isConfiguredOwner(user)) return res.status(403).json({ error: "Owner access only." });
  req.user = user;
  next();
}

// ---------- AUTH ROUTES ----------
app.post("/api/auth/signup", async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "Valid email and 8+ character password required." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "Account already exists." });

  const hash = await bcrypt.hash(password, 10);
  const id = nanoid();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)")
    .run(id, email.toLowerCase(), hash, name || null);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  setSession(res, req, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid email or password." });
  if (user.disabled) return res.status(403).json({ error: "This account has been disabled." });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password." });
  setSession(res, req, user);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => { res.clearCookie("tg_session"); res.json({ ok: true }); });

app.get("/api/auth/me", (req, res) => {
  const user = getUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

// ---------- GOOGLE OAUTH ----------
// Register both callback URLs in Google Cloud:
// https://theguiderai.dpdns.org/api/auth/google/callback
// http://localhost:3000/api/auth/google/callback
function oauthRedirectUri(req) {
  const requestOrigin = `${isSecureRequest(req) ? "https" : "http"}://${req.get("host")}`;
  const hostname = String(req.hostname || "").toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${requestOrigin.replace(/\/$/, "")}/api/auth/google/callback`;
  }

  // GOOGLE_REDIRECT_URI may be the full callback URL; APP_URL is a base URL.
  // The production default prevents a proxy/deployment hostname from changing
  // the OAuth redirect URI sent to Google.
  const configured = process.env.GOOGLE_REDIRECT_URI || process.env.APP_URL || "https://theguiderai.dpdns.org";
  return configured.replace(/\/$/, "").endsWith("/api/auth/google/callback")
    ? configured.replace(/\/$/, "")
    : `${configured.replace(/\/$/, "")}/api/auth/google/callback`;
}
app.get("/api/auth/google", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect("/login.html?oauth=unavailable");
  }
  const state = crypto.randomBytes(24).toString("hex");
  res.cookie("tg_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: isSecureRequest(req), maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: oauthRedirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});
app.get("/api/auth/google/callback", async (req, res) => {
  const fail = (reason) => res.redirect(`/login.html?oauth=${encodeURIComponent(reason)}`);
  if (!req.query.code || !req.query.state || req.query.state !== req.cookies?.tg_oauth_state) return fail("state_failed");
  res.clearCookie("tg_oauth_state");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: oauthRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) throw new Error("Token exchange failed");
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) throw new Error("Profile request failed");
    const profile = await profileResponse.json();
    if (!profile.sub || !profile.email || !profile.email_verified) throw new Error("Verified email required");
    let user = db.prepare("SELECT * FROM users WHERE oauth_provider = ? AND oauth_subject = ?").get("google", profile.sub);
    if (!user) {
      user = db.prepare("SELECT * FROM users WHERE email = ?").get(profile.email.toLowerCase());
      if (user) db.prepare("UPDATE users SET oauth_provider = ?, oauth_subject = ?, name = COALESCE(name, ?) WHERE id = ?").run("google", profile.sub, profile.name || null, user.id);
      else {
        const id = nanoid();
        // A trial is claimed once, at the first successful Google registration. It is
        // stored server-side so clearing browser data cannot create a new trial.
        db.prepare("INSERT INTO users (id, email, password_hash, name, oauth_provider, oauth_subject, trial_started_at, trial_expires_at, trial_claimed) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 month'), 1)")
          .run(id, profile.email.toLowerCase(), "oauth", profile.name || null, "google", profile.sub);
      }
      user = db.prepare("SELECT * FROM users WHERE oauth_provider = ? AND oauth_subject = ?").get("google", profile.sub);
    }
    if (user.disabled) return fail("account_disabled");
    setSession(res, req, user);
    res.redirect("/chat.html?oauth=success");
  } catch (error) {
    console.error("Google OAuth error:", error.message);
    fail("failed");
  }
});

app.patch("/api/auth/me", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: publicUser(updated) });
});

// ---------- MODELS / PLANS ----------
app.get("/api/models", (req, res) => {
  const user = getUser(req);
  const list = Object.entries(MODELS).map(([id]) => {
    const m = modelConfig(id);
    let locked = false;
    if (!m.enabled) locked = true;
    if (m.tier === "paid") locked = !canUseModel(user, id);
    if (m.tier === "guest" && user) locked = true;
    return { id, name: m.name, tier: m.tier, desc: m.desc, locked, enabled: m.enabled, dailyLimit: m.dailyLimit };
  });
  res.json({ models: list });
});

app.get("/api/plans", (req, res) => res.json({ plans: PLANS.map((item) => planConfig(item.id)) }));

app.get("/api/usage", requireAuth, (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  const used = db.prepare("SELECT model, count FROM usage_log WHERE user_id = ? AND day = ?").all(req.user.id, day);
  const models = used.map(row => { const model = modelConfig(row.model); const limit = model?.dailyLimit || 0; return { modelId: row.model, name: model?.name || row.model, used: row.count, limit, remaining: Math.max(0, limit - row.count) }; });
  res.json({ day, models, total: models.reduce((sum, item) => sum + item.used, 0) });
});

app.get("/api/announcements", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT a.*, CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS read
    FROM announcements a LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ?
    ORDER BY a.created_at DESC LIMIT 30`).all(req.user.id);
  res.json({ announcements: rows });
});
app.post("/api/announcements", requireOwner, (req, res) => {
  const { title, body } = req.body || {};
  if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: "Title and message are required." });
  const id = nanoid();
  db.prepare("INSERT INTO announcements (id, title, body) VALUES (?, ?, ?)").run(id, title.trim().slice(0, 120), body.trim().slice(0, 2000));
  audit(req.user.id, "announcement.created", id, { title: title.trim().slice(0, 120) });
  res.status(201).json({ announcement: db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) });
});
app.post("/api/announcements/:id/read", requireAuth, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- WALLET / PAYMENT HISTORY (honest — no fake balances) ----------
app.get("/api/wallet", requireAuth, (req, res) => {
  res.json({ credits: req.user.credits || 0, plan: req.user.plan });
});

app.get("/api/payments", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json({ payments: rows });
});

// ---------- BILLING (honest stub) ----------
app.post("/api/billing/checkout", requireAuth, (req, res) => {
  res.status(503).json({
    error: "Payments aren't connected yet. Add a real payment provider (JazzCash/Easypaisa/Stripe) to enable checkout.",
  });
});

// ---------- CONVERSATIONS (chat history) ----------
app.get("/api/conversations", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id, title, model, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC").all(req.user.id);
  res.json({ conversations: rows });
});

app.get("/api/conversations/:id", requireAuth, (req, res) => {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: "Not found." });
  const messages = db.prepare("SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conv.id);
  res.json({ conversation: conv, messages });
});

app.delete("/api/conversations/:id", requireAuth, (req, res) => {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!conv) return res.status(404).json({ error: "Not found." });
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conv.id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(conv.id);
  res.json({ ok: true });
});

app.patch("/api/conversations/:id", requireAuth, (req, res) => {
  const { title } = req.body || {};
  db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(title, req.params.id, req.user.id);
  res.json({ ok: true });
});
app.post("/api/conversations/:id/share", requireAuth, (req, res) => {
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const shareId = conversation.share_id || nanoid(16);
  if (!conversation.share_id) db.prepare("UPDATE conversations SET share_id = ? WHERE id = ?").run(shareId, conversation.id);
  res.json({ shareId, url: `${process.env.APP_URL || `${isSecureRequest(req) ? "https" : "http"}://${req.get("host")}`}/shared.html?s=${shareId}` });
});
app.get("/api/shared/:shareId", (req, res) => {
  const conversation = db.prepare("SELECT id, title, model, created_at FROM conversations WHERE share_id = ?").get(req.params.shareId);
  if (!conversation) return res.status(404).json({ error: "This shared conversation is unavailable." });
  const messages = db.prepare("SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversation.id);
  res.json({ conversation, messages });
});

// ---------- OWNER-ONLY ----------
app.get("/api/owner/overview", requireOwner, (req, res) => {
  const scalar = (sql) => db.prepare(sql).get().c || 0;
  const recentActivity = db.prepare(`SELECT 'request' AS type, model AS label, status AS detail, created_at FROM ai_requests
    UNION ALL SELECT 'payment', plan, status, created_at FROM payments
    UNION ALL SELECT 'user', email, plan, created_at FROM users ORDER BY created_at DESC LIMIT 20`).all();
  res.json({
    totalUsers: scalar("SELECT COUNT(*) c FROM users"), activeUsers: scalar("SELECT COUNT(DISTINCT user_id) c FROM ai_requests WHERE user_id IS NOT NULL AND created_at >= datetime('now', '-30 days')"),
    guests: scalar("SELECT COUNT(DISTINCT user_id) c FROM ai_requests WHERE user_id IS NULL"), chats: scalar("SELECT COUNT(*) c FROM conversations"),
    totalRequests: scalar("SELECT COUNT(*) c FROM ai_requests"), newUsers: scalar("SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now', '-30 days')"),
    revenue: scalar("SELECT COALESCE(SUM(amount),0) c FROM payments WHERE status = 'success'"), payments: scalar("SELECT COUNT(*) c FROM payments"),
    trialUsers: scalar("SELECT COUNT(*) c FROM users WHERE trial_expires_at > datetime('now')"), expiredTrials: scalar("SELECT COUNT(*) c FROM users WHERE trial_claimed = 1 AND (trial_expires_at IS NULL OR trial_expires_at <= datetime('now'))"),
    planDistribution: db.prepare("SELECT plan, COUNT(*) AS count FROM users GROUP BY plan").all(),
    modelUsage: db.prepare("SELECT model, COUNT(*) AS count FROM ai_requests GROUP BY model ORDER BY count DESC LIMIT 12").all(),
    recentActivity, systemStatus: maintenanceEnabled() ? "maintenance" : "operational"
  });
});
app.get("/api/owner/users", requireOwner, (req, res) => {
  const like = `%${String(req.query.q || "").trim()}%`;
  const users = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.plan,u.disabled,u.trial_started_at,u.trial_expires_at,u.trial_claimed,u.created_at,
    COALESCE((SELECT SUM(count) FROM usage_log WHERE user_id=u.id),0) AS usage,
    (SELECT COUNT(*) FROM conversations WHERE user_id=u.id) AS chats FROM users u WHERE u.email LIKE ? OR u.name LIKE ? ORDER BY u.created_at DESC LIMIT 100`).all(like, like);
  res.json({ users });
});
app.get("/api/owner/users/:id", requireOwner, (req, res) => {
  const user = db.prepare("SELECT id,email,name,role,plan,disabled,credits,trial_started_at,trial_expires_at,created_at FROM users WHERE id=?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  const usage = db.prepare("SELECT model, SUM(count) AS count FROM usage_log WHERE user_id=? GROUP BY model").all(user.id);
  const requests = db.prepare("SELECT model,status,created_at FROM ai_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 30").all(user.id);
  res.json({ user, usage, requests });
});
app.patch("/api/owner/users/:id", requireOwner, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (isConfiguredOwner(user)) return res.status(400).json({ error: "The configured owner account cannot be changed here." });
  const disabled = req.body?.disabled ? 1 : 0;
  db.prepare("UPDATE users SET disabled=? WHERE id=?").run(disabled, user.id);
  audit(req.user.id, disabled ? "user.disabled" : "user.enabled", user.id, { email: user.email });
  res.json({ ok: true });
});
app.get("/api/owner/models", requireOwner, (req, res) => res.json({ models: Object.keys(MODELS).map((id) => ({ id, ...modelConfig(id) })) }));
app.patch("/api/owner/models/:id", requireOwner, (req, res) => {
  const base = MODELS[req.params.id]; if (!base) return res.status(404).json({ error: "Model not found." });
  const { enabled, tier, dailyLimit } = req.body || {};
  if (tier && !["free","paid","guest"].includes(tier)) return res.status(400).json({ error: "Invalid model availability tier." });
  if (dailyLimit != null && (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 100000)) return res.status(400).json({ error: "Invalid daily limit." });
  const current = modelConfig(req.params.id);
  db.prepare("UPDATE owner_model_settings SET enabled=?, tier=?, daily_limit=? WHERE model_id=?").run(enabled == null ? Number(current.enabled) : Number(Boolean(enabled)), tier || current.tier, dailyLimit ?? current.dailyLimit, req.params.id);
  audit(req.user.id, "model.updated", req.params.id, { enabled, tier, dailyLimit });
  res.json({ model: { id: req.params.id, ...modelConfig(req.params.id) } });
});
app.get("/api/owner/plans", requireOwner, (req, res) => res.json({ plans: PLANS.map((item) => planConfig(item.id)) }));
app.patch("/api/owner/plans/:id", requireOwner, (req, res) => {
  const current = planConfig(req.params.id); if (!current) return res.status(404).json({ error: "Plan not found." });
  const { monthly, yearly, enabled, dailyLimit, features } = req.body || {};
  if ([monthly, yearly, dailyLimit].some((value) => value != null && (!Number.isInteger(value) || value < 0))) return res.status(400).json({ error: "Prices and limits must be non-negative integers." });
  if (features != null && (!Array.isArray(features) || features.some((id) => !MODELS[id]))) return res.status(400).json({ error: "Invalid plan features." });
  db.prepare("UPDATE owner_plan_settings SET monthly=?,yearly=?,enabled=?,daily_limit=?,features=? WHERE plan_id=?").run(monthly ?? current.monthly, yearly ?? current.yearly, enabled == null ? Number(current.enabled) : Number(Boolean(enabled)), dailyLimit ?? current.dailyLimit, JSON.stringify(features ?? current.features), req.params.id);
  audit(req.user.id, "plan.updated", req.params.id, { monthly, yearly, enabled, dailyLimit, features });
  res.json({ plan: planConfig(req.params.id) });
});
app.get("/api/owner/usage", requireOwner, (req,res) => res.json({ usage: db.prepare("SELECT user_id,model,SUM(count) AS count,MAX(day) AS last_day FROM usage_log GROUP BY user_id,model ORDER BY count DESC LIMIT 200").all() }));
app.get("/api/owner/payments", requireOwner, (req,res) => {
  const payments = db.prepare("SELECT p.*,u.email FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200").all();
  res.json({ payments, totals: db.prepare("SELECT status,COUNT(*) AS count,COALESCE(SUM(amount),0) AS amount FROM payments GROUP BY status").all() });
});
app.get("/api/owner/announcements", requireOwner, (req,res) => res.json({ announcements: db.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100").all() }));
app.patch("/api/owner/announcements/:id", requireOwner, (req,res) => {
  const { title, body } = req.body || {}; if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: "Title and message are required." });
  const result = db.prepare("UPDATE announcements SET title=?,body=? WHERE id=?").run(title.trim().slice(0,120),body.trim().slice(0,2000),req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Announcement not found." }); audit(req.user.id, "announcement.updated", req.params.id); res.json({ ok:true });
});
app.delete("/api/owner/announcements/:id", requireOwner, (req,res) => { db.prepare("DELETE FROM announcement_reads WHERE announcement_id=?").run(req.params.id); const result=db.prepare("DELETE FROM announcements WHERE id=?").run(req.params.id); if(!result.changes)return res.status(404).json({error:"Announcement not found."}); audit(req.user.id,"announcement.deleted",req.params.id);res.json({ok:true}); });
app.get("/api/owner/maintenance", requireOwner, (req,res) => res.json({ enabled: maintenanceEnabled() }));
app.patch("/api/owner/maintenance", requireOwner, (req,res) => { const enabled=Boolean(req.body?.enabled); db.prepare("UPDATE owner_settings SET value=? WHERE key='maintenance'").run(enabled?"1":"0"); audit(req.user.id,"maintenance.updated",null,{enabled});res.json({enabled}); });
app.get("/api/owner/audit", requireOwner, (req,res) => res.json({ audit: db.prepare("SELECT a.*,u.email AS owner_email FROM owner_audit_log a LEFT JOIN users u ON u.id=a.owner_id ORDER BY a.created_at DESC LIMIT 200").all() }));

// ---------- USAGE LIMIT ----------
function checkLimit(userId, modelId) {
  const model = modelConfig(modelId);
  if (!model) return { allowed: false, reason: "Unknown model." };
  if (!model.enabled) return { allowed: false, reason: `${model.name} is temporarily unavailable.` };
  const account = db.prepare("SELECT plan FROM users WHERE id = ?").get(userId);
  const planLimit = account ? planConfig(account.plan)?.dailyLimit : null;
  const day = new Date().toISOString().slice(0, 10);
  if (planLimit > 0) {
    const planUsed = db.prepare("SELECT COALESCE(SUM(count),0) AS count FROM usage_log WHERE user_id = ? AND day = ?").get(userId, day).count;
    if (planUsed >= planLimit) return { allowed: false, reason: `Daily plan limit reached (${planLimit}/day).` };
  }
  if (model.dailyLimit === 0) return { allowed: true };
  const row = db.prepare("SELECT * FROM usage_log WHERE user_id = ? AND model = ? AND day = ?").get(userId, modelId, day);
  const used = row?.count || 0;
  if (used >= model.dailyLimit) return { allowed: false, reason: `Daily limit reached for ${model.name} (${model.dailyLimit}/day).` };
  if (row) db.prepare("UPDATE usage_log SET count = count + 1 WHERE id = ?").run(row.id);
  else db.prepare("INSERT INTO usage_log (id, user_id, model, day, count) VALUES (?, ?, ?, ?, 1)").run(nanoid(), userId, modelId, day);
  return { allowed: true, remaining: model.dailyLimit - used - 1 };
}
function logRequest(userId, modelId, status) {
  db.prepare("INSERT INTO ai_requests (id, user_id, model, status) VALUES (?, ?, ?, ?)").run(nanoid(), userId, modelId, status);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function providerErrorText(detail, fallback = "The AI provider returned an error.") {
  if (!detail) return fallback;
  if (typeof detail === "string") {
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error?.message) return parsed.error.message;
      if (parsed?.message) return parsed.message;
    } catch {
      // Fall through to plain text handling below.
    }
    return detail;
  }
  if (detail?.error?.message) return detail.error.message;
  if (detail?.message) return detail.message;
  return fallback;
}

// ---------- PROVIDER CALLS ----------
async function callProvider(provider, model, messages) {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw { config: true, provider };
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages }),
    });
    if (!r.ok) {
      const detail = await r.text();
      throw { config: false, detail, provider };
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || "";
  }
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw { config: true, provider };
    const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2000, messages }),
    });
    if (!r.ok) {
      const detail = await r.text();
      throw { config: false, detail, provider };
    }
    const data = await r.json();
    return (data.content || []).map((b) => b.text).join("\n");
  }
  if (provider === "google") {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw { config: true, provider };
    const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents }),
    });
    if (!r.ok) {
      const detail = await r.text();
      throw { config: false, detail, provider };
    }
    const data = await r.json();
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  }
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw { config: true, provider };
    const r = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:3001",
        "X-Title": "The Tech Guider AI",
      },
      body: JSON.stringify({ model, messages, max_tokens: 1024 }),
    });
    if (!r.ok) {
      const detail = await r.text();
      throw { config: false, detail, provider };
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || "";
  }
  throw new Error("Unknown provider");
}

// Isolated from user conversations: these messages are never written to the
// conversations/messages tables and are available only through owner routes.
app.get("/api/owner/assistant/history", requireOwner, (req, res) => {
  res.json({ messages: db.prepare("SELECT role,content,created_at FROM owner_assistant_messages WHERE owner_id=? ORDER BY created_at ASC LIMIT 100").all(req.user.id) });
});
app.post("/api/owner/assistant", requireOwner, async (req, res) => {
  const { message, modelId = "guider-flash" } = req.body || {};
  const model = modelConfig(modelId);
  if (!message?.trim()) return res.status(400).json({ error: "Message is required." });
  if (!model) return res.status(400).json({ error: "Unknown model selected." });
  const history = db.prepare("SELECT role,content FROM owner_assistant_messages WHERE owner_id=? ORDER BY created_at DESC LIMIT 16").all(req.user.id).reverse();
  db.prepare("INSERT INTO owner_assistant_messages (id,owner_id,role,content) VALUES (?,?,?,?)").run(nanoid(),req.user.id,"user",message.trim());
  try {
    const reply = await callProvider(model.provider, model.model, [{ role:"system",content:"You are the private The Tech Guider AI Owner Assistant. Help administer the platform safely. Never reveal secrets or claim unverified operational actions." },...history,{role:"user",content:message.trim()}]);
    db.prepare("INSERT INTO owner_assistant_messages (id,owner_id,role,content) VALUES (?,?,?,?)").run(nanoid(),req.user.id,"assistant",reply);
    audit(req.user.id,"owner_assistant.used",modelId);
    res.json({ reply });
  } catch (error) {
    if (error.config) return res.status(503).json({ error: `${model.name} isn't configured.` });
    res.status(502).json({ error: "Owner Assistant provider request failed." });
  }
});

// ---------- CHAT ROUTE ----------
app.post("/api/chat", async (req, res) => {
  const { message, modelId = "guider-flash", conversationId } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: "Message is required." });

  const model = modelConfig(modelId);
  if (!model) return res.status(400).json({ error: "Unknown model selected." });

  const user = getUser(req);
  if (user?.disabled) return res.status(403).json({ error: "This account has been disabled." });
  if (maintenanceEnabled() && !isConfiguredOwner(user)) return res.status(503).json({ error: "The service is temporarily in maintenance mode." });
  if (!model.enabled) return res.status(503).json({ error: `${model.name} is temporarily unavailable.` });
  if (model.tier === "guest" && user) return res.status(400).json({ error: "Guider Offline is for guests only." });
  if (!user && model.tier !== "guest") return res.status(401).json({ error: "Please sign in to use this model. Guests can use Guider Offline." });
  if (model.tier === "paid" && !canUseModel(user, modelId)) {
    return res.status(403).json({ error: `${model.name} requires an upgrade. Visit /plans.html.` });
  }

  const usageKey = user ? user.id : (req.cookies?.tg_guest || (() => {
    const gid = nanoid();
    res.cookie("tg_guest", gid, { httpOnly: true, maxAge: 365 * 24 * 60 * 60 * 1000 });
    return gid;
  })());

  const limit = checkLimit(usageKey, modelId);
  if (!limit.allowed) return res.status(429).json({ error: limit.reason });

  // Conversation history (logged-in users only)
  let conv = null;
  let history = [];
  if (user) {
    if (conversationId) conv = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, user.id);
    if (!conv) {
      const cid = nanoid();
      db.prepare("INSERT INTO conversations (id, user_id, title, model) VALUES (?, ?, ?, ?)").run(cid, user.id, message.slice(0, 50), modelId);
      conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(cid);
    }
    history = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 20").all(conv.id);
    db.prepare("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)").run(nanoid(), conv.id, message);
  }

  try {
    const reply = await callProvider(model.provider, model.model, [
      { role: "system", content: "You are The Tech Guider AI, a helpful assistant." },
      ...history,
      { role: "user", content: message },
    ]);
    logRequest(user ? user.id : null, modelId, "success");

    if (user && conv) {
      db.prepare("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)").run(nanoid(), conv.id, reply);
      db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
    }

    res.json({ reply, remaining: limit.remaining, conversationId: conv?.id || null });
  } catch (err) {
    logRequest(user ? user.id : null, modelId, "error");
    if (err.config) return res.status(503).json({ error: `${model.name} isn't configured yet (missing ${err.provider.toUpperCase()}_API_KEY).` });
    const providerMessage = providerErrorText(err.detail, `${model.name} could not reach its ${model.provider} provider.`);
    console.error(`[chat] ${model.name} provider failure:`, providerMessage);
    res.status(502).json({
      error: `${model.name} provider error: ${providerMessage}`,
    });
  }
});

// ---------- IMAGE GENERATION ----------
app.post("/api/image/generate", requireAuth, async (req, res) => {
  if (maintenanceEnabled() && !isConfiguredOwner(req.user)) return res.status(503).json({ error: "The service is temporarily in maintenance mode." });
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: "Image generation isn't configured yet (missing OPENAI_API_KEY)." });
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: "1024x1024" }),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    logRequest(req.user.id, "guider-pro", "success");
    res.json({ url: data.data?.[0]?.url });
  } catch (err) {
    logRequest(req.user.id, "guider-pro", "error");
    console.error(err);
    res.status(502).json({ error: "Image generation failed." });
  }
});

// An API request must never receive the HTML app shell. OAuth endpoints above are
// the only API routes that intentionally redirect the browser.
app.all("/api/*", (req, res) => res.status(404).json({ error: "API endpoint not found." }));

// ---------- FRONTEND FALLBACK ----------
app.get("*", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => console.log(`✅ The Tech Guider AI running at http://localhost:${PORT}`));
}

export default app;
