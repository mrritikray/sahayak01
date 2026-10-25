-- ============================================================
-- SAHAYAK database schema (SQLite)
-- Applied automatically on every server start (idempotent).
-- All *_at_utc columns store ISO-8601 UTC strings, e.g.
--   2026-10-21T08:00:00.000Z
-- ============================================================

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  relationship TEXT NOT NULL DEFAULT '',
  notify_preference TEXT NOT NULL DEFAULT 'all',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Many-to-many: one patient can have many family members,
-- one family member can care for many patients.
CREATE TABLE IF NOT EXISTS patient_family_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  family_id INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (patient_id, family_id)
);

CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- reminder | alert_not_taken | alert_no_response | delivery_failure
  kind TEXT NOT NULL CHECK (kind IN
    ('reminder','alert_not_taken','alert_no_response','delivery_failure')),
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medicine_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  dosage TEXT NOT NULL DEFAULT '',
  -- JSON array of "HH:mm" local times, e.g. '["08:00","20:00"]'
  reminder_times TEXT NOT NULL DEFAULT '[]',
  -- JSON array of weekday numbers, 0=Sunday .. 6=Saturday
  days_of_week TEXT NOT NULL DEFAULT '[]',
  start_date TEXT NOT NULL,
  end_date TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  reminder_template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
  no_response_minutes INTEGER NOT NULL DEFAULT 30,
  -- JSON array of family_members.id; empty = notify all linked active family
  notify_family_ids TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per scheduled dose. The UNIQUE key prevents duplicate
-- reminders for the same dose even across server restarts.
CREATE TABLE IF NOT EXISTS doses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES medicine_schedules(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Snapshot fields: editing a schedule later never rewrites history.
  medicine_name TEXT NOT NULL,
  dosage TEXT NOT NULL DEFAULT '',
  scheduled_at_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
    ('PENDING','AWAITING_RESPONSE','TAKEN','NOT_TAKEN','NO_RESPONSE',
     'SEND_FAILED','CANCELLED')),
  reminder_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_utc TEXT,
  reminder_sent_at_utc TEXT,
  -- Persisted no-response deadline (backend-owned, survives restarts).
  response_due_at_utc TEXT,
  reminder_message_id TEXT,
  responded_at_utc TEXT,
  response_source TEXT,
  alerted INTEGER NOT NULL DEFAULT 0,
  late_response INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (schedule_id, scheduled_at_utc)
);
CREATE INDEX IF NOT EXISTS idx_doses_status_time ON doses (status, scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_doses_timeout ON doses (status, response_due_at_utc);
CREATE INDEX IF NOT EXISTS idx_doses_patient ON doses (patient_id, scheduled_at_utc);

-- Cryptographically secure, expiring, single-use response tokens.
-- Only a random token is stored — no patient IDs or personal data.
CREATE TABLE IF NOT EXISTS response_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dose_id INTEGER NOT NULL REFERENCES doses(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('TAKEN','NOT_TAKEN')),
  token TEXT NOT NULL UNIQUE,
  expires_at_utc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (dose_id, action)
);

-- Every outbound message attempt (reminder, family alerts, tests).
-- Partial unique index = idempotency guard for family alerts only:
-- the same (dose, alert kind, family member) can never alert twice.
CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dose_id INTEGER NOT NULL DEFAULT 0,
  patient_id INTEGER NOT NULL DEFAULT 0,
  family_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN
    ('REMINDER','FAMILY_ALERT_NOT_TAKEN','FAMILY_ALERT_NO_RESPONSE',
     'FAMILY_ALERT_DELIVERY_FAILURE','PATIENT_CONFIRMATION','TEST_MESSAGE')),
  recipient_phone TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  mode TEXT NOT NULL DEFAULT 'demo',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_dose ON notification_logs (dose_id);
CREATE INDEX IF NOT EXISTS idx_notif_family ON notification_logs (family_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_dedupe ON notification_logs (dose_id, kind, family_id)
  WHERE kind LIKE 'FAMILY_ALERT%';
CREATE INDEX IF NOT EXISTS idx_notif_message ON notification_logs (message_id)
  WHERE message_id IS NOT NULL;

-- Idempotency store: every webhook event id is recorded once.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Tracks the 24-hour WhatsApp customer-service window per phone:
-- the time of the patient's/family member's most recent inbound message.
CREATE TABLE IF NOT EXISTS inbound_sessions (
  phone TEXT PRIMARY KEY,
  last_inbound_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (created_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
