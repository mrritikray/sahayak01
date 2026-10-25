import { getDb, nowIso, audit } from './db.js';
import { config } from './config.js';
import { renderTemplate, randomToken, addMinutes } from './util.js';
import { sendMessage, getMode } from './whatsapp.js';
import { DateTime } from 'luxon';

/**
 * Core medicine workflow: dose creation, reminder sending, patient
 * responses (TAKEN / NOT_TAKEN), no-response timeout, family alerts.
 * All state transitions are transactional so duplicates are impossible:
 *  - doses has UNIQUE(schedule_id, scheduled_at_utc)
 *  - response_tokens has UNIQUE(dose_id, action) and expiry checks
 *  - notification_logs has a partial UNIQUE index on (dose_id, kind, family_id)
 *    for FAMILY_ALERT kinds — repeated clicks/webhooks cannot double-alert.
 */

// ---- Template helpers -------------------------------------------------

export function getActiveTemplate(kind) {
  const row = getDb().prepare(
    'SELECT * FROM message_templates WHERE kind = ? AND active = 1 ORDER BY updated_at DESC LIMIT 1'
  ).get(kind);
  return row || null;
}

// ---- Family resolution -------------------------------------------------

/** Family members authorised to receive alerts for a dose. */
export function resolveFamily(schedule, patientId) {
  const db = getDb();
  let ids = [];
  try { ids = JSON.parse(schedule.notify_family_ids || '[]'); } catch { ids = []; }
  let rows;
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT fm.* FROM family_members fm
       JOIN patient_family_links l ON l.family_id = fm.id
       WHERE fm.active = 1 AND l.patient_id = ? AND fm.id IN (${placeholders})`
    ).all(patientId, ...ids);
  } else {
    rows = db.prepare(
      `SELECT fm.* FROM family_members fm
       JOIN patient_family_links l ON l.family_id = fm.id
       WHERE fm.active = 1 AND l.patient_id = ?`
    ).all(patientId);
  }
  return rows;
}

// ---- Dose creation -----------------------------------------------------

export function createDose(schedule, scheduledAtUtc) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM doses WHERE schedule_id = ? AND scheduled_at_utc = ?'
  ).get(schedule.id, scheduledAtUtc);
  if (existing) return { doseId: Number(existing.id), created: false };
  const info = db.prepare(
    `INSERT INTO doses (schedule_id, patient_id, medicine_name, dosage, scheduled_at_utc, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`
  ).run(schedule.id, schedule.patient_id, schedule.medicine_name, schedule.dosage, scheduledAtUtc, nowIso());
  return { doseId: Number(info.lastInsertRowid), created: true };
}

// ---- Step A: send the scheduled reminder --------------------------------

export async function sendReminder(doseId) {
  const db = getDb();
  const dose = db.prepare(
    `SELECT d.*, s.reminder_template_id, s.no_response_minutes, s.patient_id AS pid
     FROM doses d JOIN medicine_schedules s ON s.id = d.schedule_id WHERE d.id = ?`
  ).get(doseId);
  if (!dose) return { ok: false, error: 'dose not found' };
  if (!['PENDING', 'AWAITING_RESPONSE', 'SEND_FAILED'].includes(dose.status)) {
    return { ok: false, error: `dose already ${dose.status}` };
  }

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(dose.patient_id);
  const template = dose.reminder_template_id
    ? db.prepare('SELECT * FROM message_templates WHERE id = ?').get(dose.reminder_template_id)
    : getActiveTemplate('reminder');
  const body = template?.body ??
    'Hello {{patient_name}}, reminder: please take {{medicine_name}} ({{dosage}}) scheduled at {{scheduled_time}}. Reply TAKEN or NOT TAKEN.';
  const text = renderTemplate(body, {
    patient_name: patient.full_name,
    medicine_name: dose.medicine_name,
    dosage: dose.dosage,
    scheduled_time: dose.scheduled_at_utc,
  });

  // Add response buttons/links text.
  const tak = randomToken(), nat = randomToken();
  db.prepare('INSERT OR IGNORE INTO response_tokens (dose_id, action, token, expires_at_utc, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(doseId, 'TAKEN', tak, addMinutes(nowIso(), 60), nowIso());
  db.prepare('INSERT OR IGNORE INTO response_tokens (dose_id, action, token, expires_at_utc, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(doseId, 'NOT_TAKEN', nat, addMinutes(nowIso(), 60), nowIso());
  const buttons = `\n\nReply:\nTAKEN -> ${config.publicBaseUrl}/respond/${tak}\nNOT TAKEN -> ${config.publicBaseUrl}/respond/${nat}`;

  const result = await sendMessage({
    phone: patient.phone, body: text + buttons, kind: 'REMINDER',
    doseId, patientId: dose.patient_id,
  });

  const tx = db.transaction(() => {
    if (result.status === 'failed') {
      const attempts = dose.reminder_attempts + 1;
      const next = attempts < config.maxReminderAttempts
        ? addMinutes(nowIso(), config.retryBackoffSeconds * attempts)
        : null;
      db.prepare(
        `UPDATE doses SET reminder_attempts = ?, status = ?, next_attempt_at_utc = ? WHERE id = ?`
      ).run(attempts, attempts < config.maxReminderAttempts ? 'SEND_FAILED' : 'SEND_FAILED',
        next, doseId);
    } else {
      // Successful send (or simulated). Start the persisted no-response timer.
      db.prepare(
        `UPDATE doses SET status = 'AWAITING_RESPONSE', reminder_sent_at_utc = ?,
           response_due_at_utc = ?, reminder_message_id = ?, reminder_attempts = reminder_attempts + 1
         WHERE id = ?`
      ).run(nowIso(), addMinutes(nowIso(), dose.no_response_minutes), result.messageId, doseId);
    }
  });
  tx();
  return { ok: result.status !== 'failed', mode: result.mode, status: result.status };
}

// ---- Steps B & C: patient responses --------------------------------------

export async function processResponse(token, source = 'link') {
  const db = getDb();
  const t = db.prepare(
    `SELECT rt.*, d.status AS dose_status, d.patient_id, d.response_due_at_utc
     FROM response_tokens rt JOIN doses d ON d.id = rt.dose_id WHERE rt.token = ?`
  ).get(token);

  if (!t) return { ok: false, status: 404, error: 'Invalid response link.' };
  if (t.expires_at_utc < nowIso()) return { ok: false, status: 410, error: 'This response link has expired.' };
  if (!['AWAITING_RESPONSE', 'TAKEN', 'NOT_TAKEN', 'NO_RESPONSE'].includes(t.dose_status)) {
    return { ok: false, status: 409, error: `This dose is no longer awaiting a response (status: ${t.dose_status}).` };
  }

  const dose = db.prepare('SELECT * FROM doses WHERE id = ?').get(t.dose_id);
  const schedule = db.prepare('SELECT * FROM medicine_schedules WHERE id = ?').get(dose.schedule_id);
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(dose.patient_id);
  const late = Boolean(dose.alerted); // an alert was already sent before this response

  const action = t.action;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE doses SET status = ?, responded_at_utc = ?, response_source = ?, late_response = ?,
         response_due_at_utc = NULL WHERE id = ?`
    ).run(action, nowIso(), source, late ? 1 : 0, t.dose_id);
    db.prepare('DELETE FROM response_tokens WHERE dose_id = ?').run(t.dose_id); // single use
  });
  tx();

  if (action === 'TAKEN') {
    // Step B: cancel pending alert (response_due_at cleared above);
    // no family alert is sent. Record a confirmation log for the history.
    db.prepare(
      `INSERT INTO notification_logs (dose_id, patient_id, family_id, kind, recipient_phone, status, mode, created_at)
       VALUES (?, ?, 0, 'PATIENT_CONFIRMATION', ?, 'recorded', ?, ?)`
    ).run(t.dose_id, dose.patient_id, patient.phone, getMode(), nowIso());
    return { ok: true, action, late, doseId: t.dose_id };
  }

  // Step C: NOT_TAKEN — alert all configured, authorised family members now.
  const fam = resolveFamily(schedule, dose.patient_id);
  const tmpl = getActiveTemplate('alert_not_taken');
  const base = tmpl?.body ??
    'Family alert: {{patient_name}} reported NOT TAKEN for {{medicine_name}} ({{dosage}}) scheduled at {{scheduled_time}}.';
  for (const f of fam) {
    // Partial-unique index on (dose_id, kind, family_id) makes this idempotent:
    // repeated clicks or webhook retries insert nothing new.
    try {
      await sendMessage({
        phone: f.phone, kind: 'FAMILY_ALERT_NOT_TAKEN', doseId: t.dose_id,
        patientId: dose.patient_id, familyId: f.id,
        body: renderTemplate(base, {
          patient_name: patient.full_name, medicine_name: dose.medicine_name,
          dosage: dose.dosage, scheduled_time: dose.scheduled_at_utc,
          response_status: 'NOT_TAKEN', response_time: nowIso(),
        }),
      });
    } catch (e) {
      console.error(`[workflow] family alert failed for member ${f.id}: ${e.message}`);
    }
  }
  return { ok: true, action, late, doseId: t.dose_id, familyNotified: fam.length };
}

// ---- Step D: no-response timeout -----------------------------------------

export async function processTimeouts() {
  const db = getDb();
  const due = db.prepare(
    `SELECT d.*, s.reminder_template_id FROM doses d
     JOIN medicine_schedules s ON s.id = d.schedule_id
     WHERE d.status = 'AWAITING_RESPONSE' AND d.response_due_at_utc IS NOT NULL
       AND d.response_due_at_utc <= ?`
  ).all(nowIso());

  let processed = 0;
  for (const dose of due) {
    // Re-check inside the loop under transaction: still unconfirmed?
    const tx = db.transaction(() => {
      const cur = db.prepare('SELECT status FROM doses WHERE id = ?').get(dose.id);
      if (!cur || cur.status !== 'AWAITING_RESPONSE') return false;
      db.prepare("UPDATE doses SET status = 'NO_RESPONSE', response_due_at_utc = NULL, alerted = 1 WHERE id = ?")
        .run(dose.id);
      return true;
    });
    if (!tx()) continue;
    processed++;

    const schedule = db.prepare('SELECT * FROM medicine_schedules WHERE id = ?').get(dose.schedule_id);
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(dose.patient_id);
    const fam = resolveFamily(schedule, dose.patient_id);
    const tmpl = getActiveTemplate('alert_no_response');
    const base = tmpl?.body ??
      'Family alert: {{patient_name}} did not respond within 30 minutes for {{medicine_name}} ({{dosage}}) scheduled at {{scheduled_time}}. Status: UNCONFIRMED.';
    for (const f of fam) {
      try {
        await sendMessage({
          phone: f.phone, kind: 'FAMILY_ALERT_NO_RESPONSE', doseId: dose.id,
          patientId: dose.patient_id, familyId: f.id,
          body: renderTemplate(base, {
            patient_name: patient.full_name, medicine_name: dose.medicine_name,
            dosage: dose.dosage, scheduled_time: dose.scheduled_at_utc,
            response_status: 'NO_RESPONSE',
          }),
        });
      } catch (e) {
        console.error(`[workflow] timeout alert failed for member ${f.id}: ${e.message}`);
      }
    }
  }
  return processed;
}

// ---- Scheduler ------------------------------------------------------------
//
// Persistent DB-polling scheduler. Survives restarts because everything
// it needs lives in the doses table (status, next_attempt_at_utc,
// response_due_at_utc), never in memory.

let timer = null;

export function startScheduler(intervalMs = config.schedulerIntervalMs) {
  if (timer) return;
  console.log(`[scheduler] started, polling every ${intervalMs} ms`);
  tick(); // run once immediately
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function tick() {
  const db = getDb();
  try {
    // 1. Generate doses for active schedules whose local time is due.
    generateDueDoses();
    // 2. Retry failed reminders whose backoff expired.
    const retries = db.prepare(
      `SELECT id FROM doses WHERE status = 'SEND_FAILED'
       AND next_attempt_at_utc IS NOT NULL AND next_attempt_at_utc <= ?`
    ).all(nowIso());
    for (const r of retries) await sendReminder(r.id);
    // 3. Send reminders for fresh PENDING doses.
    const pending = db.prepare(
      `SELECT id FROM doses WHERE status = 'PENDING' AND scheduled_at_utc <= ?
       ORDER BY scheduled_at_utc LIMIT 100`
    ).all(nowIso());
    for (const p of pending) await sendReminder(p.id);
    // 4. Process no-response timeouts.
    await processTimeouts();
  } catch (e) {
    console.error(`[scheduler] tick error: ${e.message}`);
  }
}

/**
 * Generate doses for any active schedule whose reminder time has arrived
 * within the current polling window. Time zones are handled with Luxon:
 * each schedule's "HH:mm" times are interpreted in the schedule's own
 * zone, so DST transitions are handled correctly.
 */
export function generateDueDoses(now = new Date()) {
  const db = getDb();
  const schedules = db.prepare('SELECT * FROM medicine_schedules WHERE active = 1').all();
  let created = 0;
  for (const s of schedules) {
    let times = [], days = [];
    try { times = JSON.parse(s.reminder_times || '[]'); } catch {}
    try { days = JSON.parse(s.days_of_week || '[]'); } catch {}
    if (!times.length || !days.length) continue;

    const zone = s.timezone || 'UTC';
    const endOfDay = DateTime.fromJSDate(now).setZone(zone).endOf('day');
    // Look back 24h (covers restarts and slow polls) and forward to end of today.
    let cursor = DateTime.fromJSDate(now).setZone(zone).minus({ hours: 24 });
    while (cursor <= endOfDay) {
      if (!days.includes(cursor.weekday % 7)) { cursor = cursor.plus({ days: 1 }); continue; }
      for (const t of times) {
        const [h, m] = String(t).split(':').map(Number);
        const local = cursor.set({ hour: h, minute: m, second: 0, millisecond: 0 });
        if (!local.isValid) continue;
        const utcIso = local.toUTC().toISO();
        if (utcIso > now.toISOString()) continue; // future — not yet due
        const { created: c } = createDose(s, utcIso);
        if (c) {
          created++;
          audit('scheduler', 'DOSE_CREATED', 'dose', '', `schedule ${s.id} at ${utcIso}`);
        }
      }
      cursor = cursor.plus({ days: 1 });
    }
  }
  return created;
}
