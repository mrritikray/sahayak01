import fs from 'node:fs';
import { getDb, nowIso, audit, getSetting, setSetting } from './db.js';
import { hashPassword } from './auth.js';

/** Seed the DEMO database with clearly-labelled fictional sample data. */
export function seed({ reset = false } = {}) {
  const db = getDb();
  if (reset) {
    db.exec(`DELETE FROM notification_logs; DELETE FROM response_tokens; DELETE FROM doses;
      DELETE FROM medicine_schedules; DELETE FROM patient_family_links;
      DELETE FROM family_members; DELETE FROM patients; DELETE FROM message_templates;
      DELETE FROM audit_logs; DELETE FROM sessions; DELETE FROM admins;`);
    console.log('[seed] existing data cleared');
  }

  const admin = db.prepare('SELECT id FROM admins LIMIT 1').get();
  if (!admin) {
    db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run('admin', hashPassword(process.env.ADMIN_PASSWORD || 'sahayak123'), nowIso());
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM patients').get().c > 0) {
    console.log('[seed] data already present — skipping (use "npm run seed:reset" to re-seed)');
    return;
  }

  const insP = db.prepare('INSERT INTO patients (full_name, phone, timezone, active, notes, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
  const p1 = Number(insP.run('Ramesh Kumar (SAMPLE)', '+917987237184', 'Asia/Kolkata', 'Primary WhatsApp Patient (7987237184)', nowIso(), nowIso()).lastInsertRowid);
  const p2 = Number(insP.run('Savitri Devi (SAMPLE)', '+919800000002', 'Asia/Kolkata', 'Fictional demo patient', nowIso(), nowIso()).lastInsertRowid);

  const insF = db.prepare('INSERT INTO family_members (name, phone, relationship, notify_preference, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
  const f1 = Number(insF.run('Anita Kumar (SAMPLE)', '+917987237184', 'Daughter', 'all', nowIso(), nowIso()).lastInsertRowid);
  const f2 = Number(insF.run('Vikram Kumar (SAMPLE)', '+919800000012', 'Son', 'all', nowIso(), nowIso()).lastInsertRowid);
  const f3 = Number(insF.run('Deepak Sharma (SAMPLE)', '+919800000013', 'Nephew', 'all', nowIso(), nowIso()).lastInsertRowid);

  const insL = db.prepare('INSERT INTO patient_family_links (patient_id, family_id, created_at) VALUES (?, ?, ?)');
  insL.run(p1, f1, nowIso()); insL.run(p1, f2, nowIso()); insL.run(p2, f3, nowIso());

  const insT = db.prepare('INSERT INTO message_templates (name, kind, body, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
  const tReminder = Number(insT.run('Standard Reminder', 'reminder',
    'Hello {{patient_name}}, this is your SAHAYAK reminder: please take {{medicine_name}} ({{dosage}}), scheduled at {{scheduled_time}}. Open a link below to confirm.',
    nowIso(), nowIso()).lastInsertRowid);
  insT.run('Family Alert — Not Taken', 'alert_not_taken',
    'SAHAYAK alert: {{patient_name}} reported NOT TAKEN for {{medicine_name}} ({{dosage}}), scheduled at {{scheduled_time}}. Please check on them.',
    nowIso(), nowIso());
  insT.run('Family Alert — No Response', 'alert_no_response',
    'SAHAYAK alert: {{patient_name}} did not confirm {{medicine_name}} ({{dosage}}), scheduled at {{scheduled_time}}, within 30 minutes. Status: UNCONFIRMED (not a verified missed dose).',
    nowIso(), nowIso());
  insT.run('Delivery Failure Warning', 'delivery_failure',
    'SAHAYAK warning: a reminder for {{patient_name}} ({{medicine_name}}) could not be delivered. Please verify manually.',
    nowIso(), nowIso());

  const insS = db.prepare(
    `INSERT INTO medicine_schedules (patient_id, medicine_name, dosage, reminder_times, days_of_week,
      start_date, timezone, reminder_template_id, no_response_minutes, notify_family_ids, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const today = nowIso().slice(0, 10);
  const s1 = Number(insS.run(p1, 'Metformin (SAMPLE)', '500 mg', '["09:00","21:00"]', '[0,1,2,3,4,5,6]',
    today, 'Asia/Kolkata', tReminder, 30, '[]', nowIso(), nowIso()).lastInsertRowid);
  const s2 = Number(insS.run(p1, 'Amlodipine (SAMPLE)', '5 mg', '["08:00"]', '[1,2,3,4,5]',
    today, 'Asia/Kolkata', tReminder, 30, `[${f1}]`, nowIso(), nowIso()).lastInsertRowid);
  const s3 = Number(insS.run(p2, 'Calcium + Vitamin D (SAMPLE)', '1 tablet', '["20:00"]', '[0,1,2,3,4,5,6]',
    today, 'Asia/Kolkata', tReminder, 30, '[]', nowIso(), nowIso()).lastInsertRowid);

  // Example dose history with one of each outcome (yesterday, demo-simulated).
  const yest = new Date(Date.now() - 24 * 3600_000).toISOString();
  const d1 = Number(db.prepare(
    `INSERT INTO doses (schedule_id, patient_id, medicine_name, dosage, scheduled_at_utc, status,
      reminder_sent_at_utc, responded_at_utc, response_source, created_at)
     VALUES (?, ?, 'Metformin (SAMPLE)', '500 mg', ?, 'TAKEN', ?, ?, 'link', ?)`
  ).run(s1, p1, yest, yest, addMin(yest, 5), nowIso()).lastInsertRowid);
  const d2 = Number(db.prepare(
    `INSERT INTO doses (schedule_id, patient_id, medicine_name, dosage, scheduled_at_utc, status,
      reminder_sent_at_utc, responded_at_utc, response_source, alerted, late_response, created_at)
     VALUES (?, ?, 'Amlodipine (SAMPLE)', '5 mg', ?, 'NOT_TAKEN', ?, ?, 'link', 1, 1, ?)`
  ).run(s2, p1, yest, yest, addMin(yest, 12), nowIso()).lastInsertRowid);
  Number(db.prepare(
    `INSERT INTO doses (schedule_id, patient_id, medicine_name, dosage, scheduled_at_utc, status,
      reminder_sent_at_utc, created_at)
     VALUES (?, ?, 'Calcium + Vitamin D (SAMPLE)', '1 tablet', ?, 'NO_RESPONSE', ?, ?)`
  ).run(s3, p2, yest, yest, nowIso()));

  db.prepare(
    `INSERT INTO notification_logs (dose_id, patient_id, family_id, kind, recipient_phone, message_id, status, mode, body, created_at)
     VALUES (?, ?, 0, 'REMINDER', '+917987237184', 'sim.seed1', 'simulated', 'demo', ?, ?)`
  ).run(d1, 'Hello Ramesh Kumar (SAMPLE), this is your SAHAYAK reminder: please take Metformin (SAMPLE) (500 mg). Open a link below to confirm.', yest, yest);
  db.prepare(
    `INSERT INTO notification_logs (dose_id, patient_id, family_id, kind, recipient_phone, message_id, status, mode, body, created_at)
     VALUES (?, ?, ?, 'FAMILY_ALERT_NOT_TAKEN', '+917987237184', 'sim.seed2', 'simulated', 'demo', ?, ?)`
  ).run(d2, f1, 'SAHAYAK alert: Ramesh Kumar (SAMPLE) reported NOT TAKEN for Amlodipine (SAMPLE) (5 mg). Please check on them.', addMin(yest, 12), addMin(yest, 12));

  audit('system', 'SEED', 'database', '', 'sample demo data created');
  console.log('[seed] demo sample data created (2 patients, 3 family members, 3 schedules, example history)');
}

function addMin(iso, m) { return new Date(new Date(iso).getTime() + m * 60000).toISOString(); }

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ reset: process.argv.includes('--reset') });
}
