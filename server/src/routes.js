import express from 'express';
import crypto from 'node:crypto';
import { getDb, nowIso, audit, getSetting, setSetting } from './db.js';
import { config, whatsappConfigured } from './config.js';
import { requireAuth, login, logout, rateLimit, ensureAdmin } from './auth.js';
import { isValidPhone, normalisePhone, renderTemplate, templateVariables, buildWhatsappUrl } from './util.js';
import { z } from 'zod';
import {
  integrationStatus, getMode, recordInbound, updateMessageStatus, testConnection, sendMessage,
} from './whatsapp.js';
import {
  startScheduler, stopScheduler, sendReminder, processResponse, processTimeouts, tick,
} from './workflow.js';

export function renderResponseSuccessHtml({ action, late, doseId, message, patientName, medicineName, dosage, whatsappNumber }) {
  const isTaken = action === 'TAKEN';
  const badgeColor = isTaken ? '#38a169' : '#e53e3e';
  const badgeBg = isTaken ? '#f0fff4' : '#fff5f5';
  const icon = isTaken ? '✅' : '⚠️';
  const title = isTaken ? 'Dose Confirmed as TAKEN' : 'Dose Marked as NOT TAKEN';
  const statusText = isTaken
    ? 'Your medicine dose has been marked as TAKEN. Great job maintaining your health schedule!'
    : 'Your medicine dose has been recorded as NOT TAKEN. Your registered family members have been alerted.';

  const cleanPhone = String(whatsappNumber || '917987237184').replace(/[^\d]/g, '');
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(`Dose confirmation recorded for ${medicineName || 'medicine'}: ${action}`)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | SAHAYAK</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f0f4f8; color: #2d3748; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
    .card { background: #ffffff; max-width: 480px; width: 100%; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.06); overflow: hidden; text-align: center; }
    .header { background: #2c7a7b; color: #ffffff; padding: 22px 20px; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .content { padding: 30px 24px; }
    .status-icon { font-size: 52px; margin-bottom: 14px; }
    .badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}; margin-bottom: 14px; }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #1a202c; }
    p { font-size: 15px; color: #4a5568; line-height: 1.6; margin-bottom: 18px; }
    .details { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 22px; text-align: left; font-size: 14px; }
    .details-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .details-label { color: #718096; }
    .details-val { font-weight: 600; color: #2d3748; }
    .btn-wa { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 14px; border-radius: 10px; background: #25D366; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; transition: background 0.2s; box-shadow: 0 4px 6px -1px rgba(37,211,102,0.3); }
    .btn-wa:hover { background: #1ebd56; }
    .redirect-note { margin-top: 14px; font-size: 13px; color: #718096; }
    .cancel-btn { background: none; border: none; color: #2c7a7b; text-decoration: underline; cursor: pointer; font-size: 13px; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">SAHAYAK Medicine Care</div>
    <div class="content">
      <div class="status-icon">${icon}</div>
      <div class="badge">${action}</div>
      <h2>${title}</h2>
      <p>${statusText}</p>
      ${medicineName ? `
      <div class="details">
        ${patientName ? `<div class="details-row"><span class="details-label">Patient:</span><span class="details-val">${patientName}</span></div>` : ''}
        <div class="details-row"><span class="details-label">Medicine:</span><span class="details-val">${medicineName} ${dosage ? `(${dosage})` : ''}</span></div>
        <div class="details-row"><span class="details-label">Recorded:</span><span class="details-val">Just now</span></div>
        ${late ? '<div class="details-row"><span class="details-label">Note:</span><span class="details-val" style="color:#d69e2e">Late response (alert already sent)</span></div>' : ''}
      </div>` : ''}
      <a id="wa-link" href="${waUrl}" class="btn-wa">
        <span>💬 Return to WhatsApp (7987237184)</span>
      </a>
      <div class="redirect-note" id="redirect-msg">
        Redirecting to WhatsApp in <strong id="countdown">4</strong> seconds...
      </div>
      <button class="cancel-btn" id="cancel-btn" onclick="cancelRedirect()">Stay on this page</button>
    </div>
  </div>
  <script>
    let seconds = 4;
    let timer = setInterval(() => {
      seconds--;
      const cd = document.getElementById('countdown');
      if (cd) cd.textContent = seconds;
      if (seconds <= 0) {
        clearInterval(timer);
        window.location.href = '${waUrl}';
      }
    }, 1000);
    function cancelRedirect() {
      clearInterval(timer);
      const msg = document.getElementById('redirect-msg');
      if (msg) msg.textContent = 'Auto-redirect cancelled. You can return to WhatsApp anytime with the button above.';
      const btn = document.getElementById('cancel-btn');
      if (btn) btn.style.display = 'none';
    }
  </script>
</body>
</html>`;
}

export function renderResponseErrorHtml(errorMsg, whatsappNumber) {
  const cleanPhone = String(whatsappNumber || '917987237184').replace(/[^\d]/g, '');
  const waUrl = `https://wa.me/${cleanPhone}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Response Status | SAHAYAK</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f0f4f8; color: #2d3748; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
    .card { background: #ffffff; max-width: 440px; width: 100%; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); overflow: hidden; text-align: center; padding: 32px 24px; }
    .header { font-size: 20px; font-weight: 700; color: #2c7a7b; margin-bottom: 20px; }
    .icon { font-size: 48px; margin-bottom: 12px; }
    h2 { font-size: 20px; font-weight: 700; color: #e53e3e; margin-bottom: 8px; }
    p { font-size: 14px; color: #4a5568; line-height: 1.5; margin-bottom: 24px; }
    .btn-wa { display: flex; align-items: center; justify-content: center; width: 100%; padding: 12px; border-radius: 8px; background: #25D366; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; }
    .btn-wa:hover { background: #1ebd56; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">SAHAYAK Medicine Care</div>
    <div class="icon">ℹ️</div>
    <h2>Notice</h2>
    <p>${errorMsg || 'This response link has already been used or expired.'}</p>
    <a href="${waUrl}" class="btn-wa">Return to WhatsApp</a>
  </div>
</body>
</html>`;
}

export async function handlePatientResponse(req, res) {
  const result = await processResponse(req.params.token, 'link');
  const prefersHtml = req.headers['accept']?.includes('text/html') && !req.headers['accept']?.includes('application/json');

  if (!result.ok) {
    if (prefersHtml) {
      return res.status(result.status || 400).send(renderResponseErrorHtml(result.error, config.defaultWhatsappPhone));
    }
    return res.status(result.status).json({ error: result.error });
  }

  const message = result.action === 'TAKEN'
    ? 'Thank you! Your medicine has been marked as TAKEN.'
    : 'Recorded. Your family members have been notified that the medicine was NOT taken.';

  if (prefersHtml) {
    return res.send(renderResponseSuccessHtml({
      action: result.action,
      late: result.late,
      doseId: result.doseId,
      message,
      patientName: result.patientName,
      medicineName: result.medicineName,
      dosage: result.dosage,
      whatsappNumber: config.defaultWhatsappPhone,
    }));
  }

  res.json({
    ok: true, action: result.action, late: result.late,
    familyNotified: result.familyNotified ?? 0,
    message,
  });
}

export function buildRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));

  // ---------- Auth ----------
  r.post('/auth/login', rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const result = login(String(username), String(password));
    if (!result) return res.status(401).json({ error: 'Invalid username or password' });
    res.json(result);
  });
  r.post('/auth/logout', (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token) logout(token);
    res.json({ ok: true });
  });
  r.get('/auth/me', requireAuth, (req, res) => res.json({ username: req.admin.username }));

  // ---------- Dashboard ----------
  r.get('/dashboard', requireAuth, (req, res) => {
    const db = getDb();
    const now = nowIso();
    const patients = db.prepare('SELECT COUNT(*) AS c FROM patients WHERE active = 1').get().c;
    const family = db.prepare('SELECT COUNT(*) AS c FROM family_members WHERE active = 1').get().c;
    const upcoming = db.prepare(
      `SELECT d.id, d.medicine_name, d.dosage, d.scheduled_at_utc, d.status, p.full_name AS patient_name
       FROM doses d JOIN patients p ON p.id = d.patient_id
       WHERE d.status IN ('PENDING','AWAITING_RESPONSE','SEND_FAILED') AND d.scheduled_at_utc >= ?
       ORDER BY d.scheduled_at_utc LIMIT 10`).all(now);
    const taken = db.prepare("SELECT COUNT(*) AS c FROM doses WHERE status = 'TAKEN'").get().c;
    const missed = db.prepare("SELECT COUNT(*) AS c FROM doses WHERE status IN ('NOT_TAKEN','NO_RESPONSE')").get().c;
    const unconfirmed = db.prepare("SELECT COUNT(*) AS c FROM doses WHERE status = 'AWAITING_RESPONSE'").get().c;
    const notifications = db.prepare(
      `SELECT id, kind, recipient_phone, status, mode, body, created_at FROM notification_logs
       ORDER BY created_at DESC LIMIT 10`).all().map(n => ({
      ...n,
      whatsapp_url: buildWhatsappUrl(n.recipient_phone, n.body || ''),
    }));
    res.json({
      activePatients: patients, linkedFamily: family, upcomingReminders: upcoming,
      medicinesTaken: taken, missedOrUnconfirmed: missed, awaitingResponse: unconfirmed,
      recentNotifications: notifications,
      whatsapp: integrationStatus(),
      schedulerRunning: Boolean(getSetting('scheduler_running')),
      mode: getMode(),
    });
  });

  // ---------- Patients ----------
  const patientSchema = z.object({
    full_name: z.string().min(1, 'Full name is required').max(120),
    phone: z.string().refine(isValidPhone, 'Phone must be 8-15 digits with country code'),
    timezone: z.string().min(1).max(64),
    active: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
    family_ids: z.array(z.number().int()).optional(),
  });

  r.get('/patients', requireAuth, (req, res) => {
    const db = getDb();
    const q = String(req.query.search || '').toLowerCase();
    let rows = db.prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM patient_family_links l WHERE l.patient_id = p.id) AS family_count
       FROM patients p ORDER BY p.id DESC`).all();
    if (q) rows = rows.filter(p => p.full_name.toLowerCase().includes(q) || p.phone.includes(q));
    res.json(rows);
  });

  r.get('/patients/:id', requireAuth, (req, res) => {
    const db = getDb();
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    p.family = db.prepare(
      `SELECT fm.id, fm.name, fm.phone, fm.relationship, fm.active FROM family_members fm
       JOIN patient_family_links l ON l.family_id = fm.id WHERE l.patient_id = ?`).all(p.id);
    p.schedules = db.prepare('SELECT * FROM medicine_schedules WHERE patient_id = ? ORDER BY id DESC').all(p.id);
    p.doseHistory = db.prepare(
      'SELECT * FROM doses WHERE patient_id = ? ORDER BY scheduled_at_utc DESC LIMIT 100').all(p.id);
    res.json(p);
  });

  r.post('/patients', requireAuth, (req, res) => {
    const parsed = patientSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const d = parsed.data;
    if (db.prepare('SELECT id FROM patients WHERE phone = ?').get(normalisePhone(d.phone))) {
      return res.status(409).json({ error: 'A patient with this phone number already exists' });
    }
    const info = db.prepare(
      `INSERT INTO patients (full_name, phone, timezone, active, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(d.full_name, normalisePhone(d.phone), d.timezone, d.active === false ? 0 : 1, d.notes || '', nowIso(), nowIso());
    const id = Number(info.lastInsertRowid);
    for (const fid of d.family_ids || []) {
      db.prepare('INSERT OR IGNORE INTO patient_family_links (patient_id, family_id, created_at) VALUES (?, ?, ?)')
        .run(id, fid, nowIso());
    }
    audit(req.admin.username, 'CREATE', 'patient', id, d.full_name);
    res.status(201).json({ id });
  });

  r.put('/patients/:id', requireAuth, (req, res) => {
    const parsed = patientSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    const d = parsed.data;
    const clash = db.prepare('SELECT id FROM patients WHERE phone = ? AND id != ?').get(normalisePhone(d.phone), p.id);
    if (clash) return res.status(409).json({ error: 'Another patient with this phone number already exists' });
    db.prepare(
      `UPDATE patients SET full_name = ?, phone = ?, timezone = ?, active = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(d.full_name, normalisePhone(d.phone), d.timezone, d.active === false ? 0 : 1, d.notes || '', nowIso(), p.id);
    if (d.family_ids) {
      db.prepare('DELETE FROM patient_family_links WHERE patient_id = ?').run(p.id);
      for (const fid of d.family_ids) {
        db.prepare('INSERT OR IGNORE INTO patient_family_links (patient_id, family_id, created_at) VALUES (?, ?, ?)')
          .run(p.id, fid, nowIso());
      }
    }
    audit(req.admin.username, 'UPDATE', 'patient', p.id, d.full_name);
    res.json({ ok: true });
  });

  r.patch('/patients/:id/active', requireAuth, (req, res) => {
    const db = getDb();
    const active = req.body?.active ? 1 : 0;
    const p = db.prepare('SELECT id FROM patients WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    db.prepare('UPDATE patients SET active = ?, updated_at = ? WHERE id = ?').run(active, nowIso(), p.id);
    if (!active) {
      // Deactivating pauses future scheduling; recorded history is preserved.
      db.prepare(
        `UPDATE doses SET status = 'CANCELLED', response_due_at_utc = NULL
         WHERE patient_id = ? AND status IN ('PENDING','SEND_FAILED')`).run(p.id);
    }
    audit(req.admin.username, active ? 'ACTIVATE' : 'DEACTIVATE', 'patient', p.id);
    res.json({ ok: true });
  });

  r.delete('/patients/:id', requireAuth, (req, res) => {
    const db = getDb();
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    // Audit history (notification/audit logs) is retained; the patient and
    // their schedules/doses are removed only by explicit confirmed deletion.
    db.prepare('DELETE FROM patients WHERE id = ?').run(p.id);
    audit(req.admin.username, 'DELETE', 'patient', p.id, p.full_name);
    res.json({ ok: true });
  });

  // ---------- Family members ----------
  const familySchema = z.object({
    name: z.string().min(1, 'Name is required').max(120),
    phone: z.string().refine(isValidPhone, 'Phone must be 8-15 digits with country code'),
    relationship: z.string().max(120).optional(),
    notify_preference: z.enum(['all', 'missed_only']).optional(),
    active: z.boolean().optional(),
    patient_ids: z.array(z.number().int()).optional(),
  });

  r.get('/family', requireAuth, (req, res) => {
    const db = getDb();
    let rows = db.prepare(
      `SELECT fm.*,
        (SELECT COUNT(*) FROM patient_family_links l WHERE l.family_id = fm.id) AS patient_count
       FROM family_members fm ORDER BY fm.id DESC`).all();
    const q = String(req.query.search || '').toLowerCase();
    if (q) rows = rows.filter(f => f.name.toLowerCase().includes(q) || f.phone.includes(q));
    res.json(rows);
  });

  r.get('/family/:id', requireAuth, (req, res) => {
    const db = getDb();
    const f = db.prepare('SELECT * FROM family_members WHERE id = ?').get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Family member not found' });
    f.patients = db.prepare(
      `SELECT p.id, p.full_name, p.active FROM patients p
       JOIN patient_family_links l ON l.patient_id = p.id WHERE l.family_id = ?`).all(f.id);
    f.notifications = db.prepare(
      'SELECT * FROM notification_logs WHERE family_id = ? ORDER BY created_at DESC LIMIT 100').all(f.id);
    res.json(f);
  });

  r.post('/family', requireAuth, (req, res) => {
    const parsed = familySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const d = parsed.data;
    if (db.prepare('SELECT id FROM family_members WHERE phone = ?').get(normalisePhone(d.phone))) {
      return res.status(409).json({ error: 'A family member with this phone number already exists' });
    }
    const info = db.prepare(
      `INSERT INTO family_members (name, phone, relationship, notify_preference, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(d.name, normalisePhone(d.phone), d.relationship || '', d.notify_preference || 'all',
      d.active === false ? 0 : 1, nowIso(), nowIso());
    const id = Number(info.lastInsertRowid);
    for (const pid of d.patient_ids || []) {
      db.prepare('INSERT OR IGNORE INTO patient_family_links (patient_id, family_id, created_at) VALUES (?, ?, ?)')
        .run(pid, id, nowIso());
    }
    audit(req.admin.username, 'CREATE', 'family_member', id, d.name);
    res.status(201).json({ id });
  });

  r.put('/family/:id', requireAuth, (req, res) => {
    const parsed = familySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const f = db.prepare('SELECT * FROM family_members WHERE id = ?').get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Family member not found' });
    const d = parsed.data;
    const clash = db.prepare('SELECT id FROM family_members WHERE phone = ? AND id != ?').get(normalisePhone(d.phone), f.id);
    if (clash) return res.status(409).json({ error: 'Another family member with this phone number already exists' });
    db.prepare(
      `UPDATE family_members SET name = ?, phone = ?, relationship = ?, notify_preference = ?, active = ?, updated_at = ? WHERE id = ?`
    ).run(d.name, normalisePhone(d.phone), d.relationship || '', d.notify_preference || 'all',
      d.active === false ? 0 : 1, nowIso(), f.id);
    if (d.patient_ids) {
      db.prepare('DELETE FROM patient_family_links WHERE family_id = ?').run(f.id);
      for (const pid of d.patient_ids) {
        db.prepare('INSERT OR IGNORE INTO patient_family_links (patient_id, family_id, created_at) VALUES (?, ?, ?)')
          .run(pid, f.id, nowIso());
      }
    }
    audit(req.admin.username, 'UPDATE', 'family_member', f.id, d.name);
    res.json({ ok: true });
  });

  r.patch('/family/:id/active', requireAuth, (req, res) => {
    const db = getDb();
    const active = req.body?.active ? 1 : 0;
    const f = db.prepare('SELECT id FROM family_members WHERE id = ?').get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Family member not found' });
    db.prepare('UPDATE family_members SET active = ?, updated_at = ? WHERE id = ?').run(active, nowIso(), f.id);
    audit(req.admin.username, active ? 'ACTIVATE' : 'DEACTIVATE', 'family_member', f.id);
    res.json({ ok: true });
  });

  // Removing a relationship without deleting unrelated records.
  r.delete('/links/:patientId/:familyId', requireAuth, (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM patient_family_links WHERE patient_id = ? AND family_id = ?')
      .run(req.params.patientId, req.params.familyId);
    audit(req.admin.username, 'UNLINK', 'patient_family_link', `${req.params.patientId}/${req.params.familyId}`);
    res.json({ ok: true });
  });

  // ---------- Medicines & schedules ----------
  const scheduleSchema = z.object({
    patient_id: z.number().int(),
    medicine_name: z.string().min(1, 'Medicine name is required').max(120),
    dosage: z.string().max(120).optional(),
    reminder_times: z.array(z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:mm')).min(1, 'At least one reminder time is required'),
    days_of_week: z.array(z.number().int().min(0).max(6)).min(1, 'Select at least one day'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    timezone: z.string().min(1).max(64),
    reminder_template_id: z.number().int().nullable().optional(),
    no_response_minutes: z.number().int().min(1).max(720),
    notify_family_ids: z.array(z.number().int()).optional(),
    active: z.boolean().optional(),
  });

  r.get('/schedules', requireAuth, (req, res) => {
    const db = getDb();
    let rows = db.prepare(
      `SELECT s.*, p.full_name AS patient_name FROM medicine_schedules s
       JOIN patients p ON p.id = s.patient_id ORDER BY s.id DESC`).all();
    const q = String(req.query.search || '').toLowerCase();
    if (q) rows = rows.filter(s => s.medicine_name.toLowerCase().includes(q) || (s.patient_name || '').toLowerCase().includes(q));
    res.json(rows);
  });

  r.post('/schedules', requireAuth, (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const d = parsed.data;
    if (!db.prepare('SELECT id FROM patients WHERE id = ?').get(d.patient_id)) {
      return res.status(400).json({ error: 'Selected patient does not exist' });
    }
    const info = db.prepare(
      `INSERT INTO medicine_schedules (patient_id, medicine_name, dosage, reminder_times, days_of_week,
        start_date, end_date, timezone, reminder_template_id, no_response_minutes, notify_family_ids, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(d.patient_id, d.medicine_name, d.dosage || '', JSON.stringify(d.reminder_times),
      JSON.stringify(d.days_of_week), d.start_date, d.end_date || null, d.timezone,
      d.reminder_template_id || null, d.no_response_minutes, JSON.stringify(d.notify_family_ids || []),
      d.active === false ? 0 : 1, nowIso(), nowIso());
    audit(req.admin.username, 'CREATE', 'medicine_schedule', Number(info.lastInsertRowid), d.medicine_name);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/schedules/:id', requireAuth, (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const s = db.prepare('SELECT * FROM medicine_schedules WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Schedule not found' });
    const d = parsed.data;
    db.prepare(
      `UPDATE medicine_schedules SET patient_id = ?, medicine_name = ?, dosage = ?, reminder_times = ?,
        days_of_week = ?, start_date = ?, end_date = ?, timezone = ?, reminder_template_id = ?,
        no_response_minutes = ?, notify_family_ids = ?, active = ?, updated_at = ? WHERE id = ?`
    ).run(d.patient_id, d.medicine_name, d.dosage || '', JSON.stringify(d.reminder_times),
      JSON.stringify(d.days_of_week), d.start_date, d.end_date || null, d.timezone,
      d.reminder_template_id || null, d.no_response_minutes, JSON.stringify(d.notify_family_ids || []),
      d.active === false ? 0 : 1, nowIso(), s.id);
    // Schedule changes affect future reminders only; already-recorded doses
    // are snapshots and are never rewritten.
    audit(req.admin.username, 'UPDATE', 'medicine_schedule', s.id, d.medicine_name);
    res.json({ ok: true });
  });

  r.patch('/schedules/:id/active', requireAuth, (req, res) => {
    const db = getDb();
    const active = req.body?.active ? 1 : 0;
    const s = db.prepare('SELECT id FROM medicine_schedules WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Schedule not found' });
    db.prepare('UPDATE medicine_schedules SET active = ?, updated_at = ? WHERE id = ?').run(active, nowIso(), s.id);
    if (!active) {
      db.prepare(
        `UPDATE doses SET status = 'CANCELLED', response_due_at_utc = NULL
         WHERE schedule_id = ? AND status IN ('PENDING','SEND_FAILED')`).run(s.id);
    }
    audit(req.admin.username, active ? 'ACTIVATE' : 'PAUSE', 'medicine_schedule', s.id);
    res.json({ ok: true });
  });

  r.delete('/schedules/:id', requireAuth, (req, res) => {
    const db = getDb();
    const s = db.prepare('SELECT id FROM medicine_schedules WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Schedule not found' });
    db.prepare('DELETE FROM medicine_schedules WHERE id = ?').run(s.id);
    audit(req.admin.username, 'DELETE', 'medicine_schedule', s.id);
    res.json({ ok: true });
  });

  // ---------- Message templates ----------
  r.get('/templates', requireAuth, (req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM message_templates ORDER BY kind, id').all());
  });

  const templateSchema = z.object({
    name: z.string().min(1).max(120),
    kind: z.enum(['reminder', 'alert_not_taken', 'alert_no_response', 'delivery_failure']),
    body: z.string().min(1, 'Template body is required').max(4000),
    active: z.boolean().optional(),
  });

  r.post('/templates', requireAuth, (req, res) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const d = parsed.data;
    // Validate variables: only whitelisted ones survive renderTemplate, but
    // warn-reject clearly unknown ones so admins get feedback before saving.
    const unknown = templateVariables(d.body).filter(v => ![
      'patient_name', 'medicine_name', 'dosage', 'scheduled_time', 'response_status', 'response_time',
    ].includes(v));
    if (unknown.length) {
      return res.status(400).json({ error: `Unknown template variable(s): ${unknown.join(', ')}` });
    }
    const info = db.prepare(
      'INSERT INTO message_templates (name, kind, body, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(d.name, d.kind, d.body, d.active === false ? 0 : 1, nowIso(), nowIso());
    audit(req.admin.username, 'CREATE', 'message_template', Number(info.lastInsertRowid), d.name);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/templates/:id', requireAuth, (req, res) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const db = getDb();
    const t = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    const d = parsed.data;
    const unknown = templateVariables(d.body).filter(v => ![
      'patient_name', 'medicine_name', 'dosage', 'scheduled_time', 'response_status', 'response_time',
    ].includes(v));
    if (unknown.length) return res.status(400).json({ error: `Unknown template variable(s): ${unknown.join(', ')}` });
    db.prepare('UPDATE message_templates SET name = ?, kind = ?, body = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(d.name, d.kind, d.body, d.active === false ? 0 : 1, nowIso(), t.id);
    audit(req.admin.username, 'UPDATE', 'message_template', t.id, d.name);
    res.json({ ok: true });
  });

  r.post('/templates/preview', requireAuth, (req, res) => {
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'body is required' });
    res.json({
      rendered: renderTemplate(body, {
        patient_name: 'Ramesh Kumar (SAMPLE)', medicine_name: 'Metformin (SAMPLE)',
        dosage: '500 mg', scheduled_time: '2026-10-21 09:00',
        response_status: 'NOT_TAKEN', response_time: nowIso(),
      }),
      variables: templateVariables(body),
    });
  });

  // ---------- Reminder history ----------
  r.get('/history', requireAuth, (req, res) => {
    const db = getDb();
    const clauses = [], params = [];
    const { patient, family, medicine, from, to, dose_status, message_status, mode } = req.query;
    if (patient) { clauses.push('n.patient_id = ?'); params.push(Number(patient)); }
    if (family) { clauses.push('n.family_id = ?'); params.push(Number(family)); }
    if (medicine) { clauses.push('n.kind LIKE ? OR d.medicine_name LIKE ?'); params.push(`%${medicine}%`, `%${medicine}%`); }
    if (from) { clauses.push('n.created_at >= ?'); params.push(new Date(from).toISOString()); }
    if (to) { clauses.push('n.created_at <= ?'); params.push(new Date(to).toISOString()); }
    if (message_status) { clauses.push('n.status = ?'); params.push(String(message_status)); }
    if (mode) { clauses.push('n.mode = ?'); params.push(String(mode)); }
    let sql = `
      SELECT n.*, p.full_name AS patient_name, d.medicine_name, d.status AS dose_status,
             d.scheduled_at_utc, fm.name AS family_name
      FROM notification_logs n
      LEFT JOIN patients p ON p.id = n.patient_id
      LEFT JOIN doses d ON d.id = n.dose_id
      LEFT JOIN family_members fm ON fm.id = n.family_id`;
    if (dose_status) { clauses.push('d.status = ?'); params.push(String(dose_status)); }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY n.created_at DESC LIMIT 300';
    const rows = db.prepare(sql).all(...params).map(r => ({
      ...r,
      whatsapp_url: buildWhatsappUrl(r.recipient_phone, r.body || ''),
    }));
    res.json(rows);
  });

  r.get('/audit', requireAuth, (req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 300').all());
  });

  // ---------- Dose / simulator actions ----------
  // Simulator: confirm the dose of a schedule now (accelerated testing).
  r.post('/simulator/confirm-dose', requireAuth, async (req, res) => {
    const db = getDb();
    const scheduleId = Number(req.body?.schedule_id);
    const s = db.prepare('SELECT * FROM medicine_schedules WHERE id = ?').get(scheduleId);
    if (!s) return res.status(404).json({ error: 'Schedule not found' });
    const due = nowIso();
    const info = db.prepare(
      `INSERT INTO doses (schedule_id, patient_id, medicine_name, dosage, scheduled_at_utc, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`
    ).run(s.id, s.patient_id, s.medicine_name, s.dosage, due, nowIso());
    const result = await sendReminder(Number(info.lastInsertRowid));
    audit(req.admin.username, 'SIMULATE_DOSE', 'dose', info.lastInsertRowid, `schedule ${s.id}`);
    res.json({ doseId: Number(info.lastInsertRowid), ...result });
  });

  // Accelerated timeout test: process the timeout for one AWAITING_RESPONSE dose now.
  r.post('/simulator/force-timeout', requireAuth, async (req, res) => {
    const db = getDb();
    const doseId = Number(req.body?.dose_id);
    const dose = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    if (!dose) return res.status(404).json({ error: 'Dose not found' });
    if (dose.status !== 'AWAITING_RESPONSE') {
      return res.status(409).json({ error: `Dose status is ${dose.status}, not AWAITING_RESPONSE` });
    }
    db.prepare('UPDATE doses SET response_due_at_utc = ? WHERE id = ?').run(nowIso(), doseId);
    await processTimeouts();
    audit(req.admin.username, 'FORCE_TIMEOUT', 'dose', doseId);
    res.json({ ok: true });
  });

  r.get('/doses', requireAuth, (req, res) => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT d.*, p.full_name AS patient_name, p.phone AS patient_phone FROM doses d
       JOIN patients p ON p.id = d.patient_id ORDER BY d.scheduled_at_utc DESC LIMIT 100`).all();
    res.json(rows.map(d => {
      const tokens = db.prepare('SELECT action, token FROM response_tokens WHERE dose_id = ?').all(d.id);
      let takenUrl = '', notTakenUrl = '';
      for (const t of tokens) {
        if (t.action === 'TAKEN') takenUrl = `${config.publicBaseUrl}/respond/${t.token}`;
        if (t.action === 'NOT_TAKEN') notTakenUrl = `${config.publicBaseUrl}/respond/${t.token}`;
      }
      const reminderText = `Hello ${d.patient_name}, reminder: please take ${d.medicine_name} (${d.dosage}).\n\nConfirm dose:\n✅ TAKEN: ${takenUrl}\n❌ NOT TAKEN: ${notTakenUrl}`;
      return {
        ...d,
        whatsapp_url: buildWhatsappUrl(d.patient_phone, reminderText),
      };
    }));
  });

  // ---------- Settings & integrations ----------
  r.get('/settings', requireAuth, (req, res) => {
    res.json({
      whatsapp: integrationStatus(),
      scheduler: {
        running: Boolean(getSetting('scheduler_running')),
        intervalMs: config.schedulerIntervalMs,
        maxAttempts: config.maxReminderAttempts,
        backoffSeconds: config.retryBackoffSeconds,
      },
      mode: getMode(),
      publicBaseUrl: config.publicBaseUrl,
      defaultPhone: config.defaultWhatsappPhone || '+917987237184',
    });
  });

  // Explicit confirmation is required from the UI before calling this.
  r.post('/settings/test-connection', requireAuth, async (req, res) => {
    res.json(await testConnection());
  });

  r.post('/settings/test-message', requireAuth, async (req, res) => {
    const phone = String(req.body?.phone || config.defaultWhatsappPhone || '+917987237184');
    if (!isValidPhone(phone)) return res.status(400).json({ error: 'Valid phone with country code required' });
    const result = await sendMessage({
      phone, kind: 'TEST_MESSAGE',
      body: 'SAHAYAK test message: your WhatsApp integration is active and working with +917987237184. (This is a test, no action needed.)',
    });
    audit(req.admin.username, 'TEST_MESSAGE', 'whatsapp', '', phone);
    res.json(result);
  });

  // ---------- Public: patient response via secure link ----------
  r.get('/respond/:token', rateLimit({ windowMs: 60_000, max: 30 }), handlePatientResponse);

  // Simulator response endpoint (dashboard patient-response simulator).
  r.post('/simulator/respond', requireAuth, async (req, res) => {
    const { dose_id, action } = req.body || {};
    if (!['TAKEN', 'NOT_TAKEN'].includes(action)) return res.status(400).json({ error: 'action must be TAKEN or NOT_TAKEN' });
    const db = getDb();
    const existing = db.prepare(
      'SELECT token FROM response_tokens WHERE dose_id = ? AND action = ?').get(Number(dose_id), action);
    if (!existing) return res.status(404).json({ error: 'No pending response token for this dose/action' });
    const result = await processResponse(existing.token, 'simulator');
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  });

  // ---------- WhatsApp webhook ----------
  r.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === config.whatsapp.verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  r.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    let payload;
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      // Signature verification uses the raw payload bytes.
      if (config.whatsapp.appSecret) {
        const sig = req.headers['x-hub-signature-256'];
        const expected = 'sha256=' + crypto.createHmac('sha256', config.whatsapp.appSecret)
          .update(raw).digest('hex');
        const a = Buffer.from(sig || ''), b = Buffer.from(expected);
        if (!sig || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return res.sendStatus(401);
        }
      }
      payload = JSON.parse(raw.toString('utf8'));
    } catch { return res.sendStatus(400); }
    // Process synchronously before acknowledging so tests and small payloads
    // are handled deterministically (Meta only requires a fast 200).
    try {
      const db = getDb();
      for (const entry of payload?.entry || []) {
        for (const change of entry?.changes || []) {
          const value = change?.value || {};
          // Idempotency: record every event id once.
          const eventId = `${entry.id}:${value.messages?.[0]?.id || value.statuses?.[0]?.id || Date.now()}`;
          const seen = db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(eventId);
          if (seen) continue;
          db.prepare('INSERT INTO webhook_events (event_id, payload, created_at) VALUES (?, ?, ?)')
            .run(eventId, JSON.stringify(payload).slice(0, 8000), nowIso());

          for (const msg of value.messages || []) {
            const from = msg.from ? '+' + msg.from : '';
            if (from) recordInbound(from);
            // If the patient replies "TAKEN" / "NOT TAKEN" as text or button,
            // match it to their most recent AWAITING_RESPONSE dose.
            const bodyText = (msg.text?.body || msg.interactive?.button_reply?.title ||
              msg.interactive?.list_reply?.title || '').trim().toUpperCase();
            if (['TAKEN', 'NOT TAKEN', 'NOTTAKEN'].includes(bodyText)) {
              const action = bodyText === 'TAKEN' ? 'TAKEN' : 'NOT_TAKEN';
              const dose = db.prepare(
                `SELECT d.id FROM doses d JOIN patients p ON p.id = d.patient_id
                 WHERE p.phone = ? AND d.status = 'AWAITING_RESPONSE'
                 ORDER BY d.scheduled_at_utc DESC LIMIT 1`).get(from);
              if (dose) {
                const tok = db.prepare(
                  'SELECT token FROM response_tokens WHERE dose_id = ? AND action = ?')
                  .get(dose.id, action);
                if (tok) await processResponse(tok.token, 'whatsapp_message');
              }
            }
          }
          for (const st of value.statuses || []) {
            updateMessageStatus(st.id, st.status, st.timestamp);
          }
        }
      }
    } catch (e) {
      console.error(`[webhook] processing error: ${e.message}`);
    }
    res.sendStatus(200);
  });

  return r;
}

// Expose ensureAdmin for the server bootstrap.
export { ensureAdmin };
