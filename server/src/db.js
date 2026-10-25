import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the built-in node:sqlite module through require() so test runners
// that transform source (Vitest/Vite) don't try to bundle it.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

let db;

export function getDb(dbPath = config.dbPath) {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  try { db.exec("ALTER TABLE notification_logs ADD COLUMN body TEXT NOT NULL DEFAULT '';"); } catch {}
  attachTransactionHelper(db);
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}

/** For tests: fresh in-memory database with the full schema. */
export function freshDb() {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  attachTransactionHelper(db);
  return db;
}

/**
 * node:sqlite's DatabaseSync has no .transaction() helper, so provide one
 * compatible with better-sqlite3's API: db.transaction(fn) returns a
 * wrapped function that runs fn inside BEGIN/COMMIT (with ROLLBACK on error).
 */
function attachTransactionHelper(db) {
  if (db.transaction) return;
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  };
}

export function nowIso() { return new Date().toISOString(); }

export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb().prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

export function audit(actor, action, entity = '', entityId = '', details = '') {
  getDb().prepare(
    'INSERT INTO audit_logs (actor, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(actor, action, entity, String(entityId), details, nowIso());
}
