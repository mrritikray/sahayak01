import crypto from 'node:crypto';
import { getDb, nowIso, audit } from './db.js';
import { config } from './config.js';

/** scrypt password hashing (built-in, no native deps). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash));
}

export function ensureAdmin() {
  const db = getDb();
  const exists = db.prepare('SELECT id FROM admins WHERE username = ?').get(config.adminUsername);
  if (!exists) {
    db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(config.adminUsername, hashPassword(config.adminPassword), nowIso());
    console.log(`[auth] created admin "${config.adminUsername}" (password from server/.env)`);
  }
}

export function login(username, password) {
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString();
  db.prepare('INSERT INTO sessions (token, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, admin.id, nowIso(), expires);
  audit(username, 'LOGIN', 'admin', admin.id);
  return { token, username: admin.username, expiresAt: expires };
}

export function logout(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const row = getDb().prepare(
    `SELECT s.token, s.expires_at, a.username FROM sessions s
     JOIN admins a ON a.id = s.admin_id WHERE s.token = ?`).get(token);
  if (!row || row.expires_at < nowIso()) {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
  req.admin = { username: row.username };
  next();
}

/** Simple fixed-window rate limiter, e.g. for login and public response endpoints. */
export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${Math.floor(Date.now() / windowMs)}`;
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);
    if (count > max) return res.status(429).json({ error: 'Too many requests — try again in a minute' });
    next();
  };
}
