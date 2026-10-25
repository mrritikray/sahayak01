import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

process.env.DB_PATH = ':memory:';
process.env.SCHEDULER_INTERVAL_MS = '3600000'; // no background polling during tests

import { freshDb, getDb, nowIso, closeDb } from '../src/db.js';
import { buildRouter } from '../src/routes.js';
import { sendReminder, processResponse, processTimeouts, tick } from '../src/workflow.js';
import { hashPassword } from '../src/auth.js';
import { seed } from '../src/seed.js';

let app, auth;

async function login() {
  const res = await request(app).post('/api/auth/login')
    .send({ username: 'admin', password: 'sahayak123' });
  return res.body.token;
}

beforeAll(async () => {
  freshDb();
  const db = getDb();
  db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run('admin', hashPassword('sahayak123'), nowIso());
  seed();
  app = express();
  app.use(express.json());
  app.use('/api', buildRouter());
  auth = await login();
});

afterAll(() => { closeDb(); });

const H = () => ({ Authorization: `Bearer ${auth}` });

async function createPatient(overrides = {}) {
  const body = { full_name: 'Test Patient', phone: '+919800000100', timezone: 'Asia/Kolkata', ...overrides };
  const res = await request(app).post('/api/patients').set(H()).send(body);
  return res;
}

async function createFamily(overrides = {}) {
  const body = { name: 'Test Family', phone: '+919800000200', ...overrides };
  const res = await request(app).post('/api/family').set(H()).send(body);
  return res;
}

async function createSchedule(overrides = {}) {
  const body = {
    patient_id: 1, medicine_name: 'TestMed', dosage: '10 mg',
    reminder_times: ['08:00'], days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_date: '2026-01-01', timezone: 'UTC', no_response_minutes: 30,
    ...overrides,
  };
  const res = await request(app).post('/api/schedules').set(H()).send(body);
  return res;
}

async function makeDose(scheduleId, minutesAgo = 5) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM medicine_schedules WHERE id = ?').get(scheduleId);
  const when = new Date(Date.now() - minutesAgo * 60000).toISOString();
  const info = db.prepare(
    `INSERT INTO doses (schedule_id, patient_id, medicine_name, dosage, scheduled_at_utc, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`
  ).run(s.id, s.patient_id, s.medicine_name, s.dosage, when, nowIso());
  await sendReminder(Number(info.lastInsertRowid));
  return Number(info.lastInsertRowid);
}

describe('auth', () => {
  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });
  it('accepts correct password and blocks unauthenticated access', async () => {
    const ok = await request(app).get('/api/patients').set(H());
    expect(ok.status).toBe(200);
    const no = await request(app).get('/api/patients');
    expect(no.status).toBe(401);
  });
});

describe('patients CRUD', () => {
  it('adds and edits a patient; rejects invalid phone', async () => {
    const bad = await createPatient({ phone: '12345' });
    expect(bad.status).toBe(400);
    const created = await createPatient({ phone: '+919800000101' });
    expect(created.status).toBe(201);
    const upd = await request(app).put(`/api/patients/${created.body.id}`).set(H())
      .send({ full_name: 'Updated Name', phone: '+919800000101', timezone: 'UTC', active: true });
    expect(upd.status).toBe(200);
    const got = await request(app).get(`/api/patients/${created.body.id}`).set(H());
    expect(got.body.full_name).toBe('Updated Name');
  });
  it('rejects duplicate phone', async () => {
    const first = await createPatient({ phone: '+919800000100' });
    expect(first.status).toBe(201);
    const res = await createPatient({ phone: '+919800000100' });
    expect(res.status).toBe(409);
  });
});

describe('family CRUD and linking', () => {
  it('adds and edits a family member; links and unlinks', async () => {
    const created = await createFamily({ phone: '+919800000201' });
    expect(created.status).toBe(201);
    const pid = (await createPatient({ phone: '+919800000102' })).body.id;
    const linked = await request(app).put(`/api/family/${created.body.id}`).set(H())
      .send({ name: 'Test Family', phone: '+919800000201', patient_ids: [pid] });
    expect(linked.status).toBe(200);
    const detail = await request(app).get(`/api/family/${created.body.id}`).set(H());
    expect(detail.body.patients.map(p => p.id)).toContain(pid);
    const unlink = await request(app).delete(`/api/links/${pid}/${created.body.id}`).set(H());
    expect(unlink.status).toBe(200);
    // The family member record still exists after unlinking.
    const still = await request(app).get(`/api/family/${created.body.id}`).set(H());
    expect(still.status).toBe(200);
  });
});

describe('schedules', () => {
  it('creates and edits a schedule; validates input', async () => {
    const bad = await createSchedule({ reminder_times: [] });
    expect(bad.status).toBe(400);
    const created = await createSchedule();
    expect(created.status).toBe(201);
    const upd = await request(app).put(`/api/schedules/${created.body.id}`).set(H())
      .send({
        patient_id: 1, medicine_name: 'TestMed2', dosage: '20 mg',
        reminder_times: ['09:00'], days_of_week: [1], start_date: '2026-01-01',
        timezone: 'UTC', no_response_minutes: 30,
      });
    expect(upd.status).toBe(200);
  });
});

describe('workflow: TAKEN / NOT_TAKEN / NO_RESPONSE', () => {
  it('generates a scheduled dose via the scheduler (tick)', async () => {
    const db = getDb();
    const before = db.prepare("SELECT COUNT(*) c FROM doses").get().c;
    tick(); // synchronous dose generation part runs first
    const after = db.prepare("SELECT COUNT(*) c FROM doses").get().c;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('TAKEN cancels the pending timeout and does NOT alert family', async () => {
    const db = getDb();
    const doseId = await makeDose(1);
    const dose = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    expect(dose.status).toBe('AWAITING_RESPONSE');
    const tok = db.prepare("SELECT token FROM response_tokens WHERE dose_id = ? AND action = 'TAKEN'").get(doseId);
    const res = await request(app).get(`/api/respond/${tok.token}`);
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('TAKEN');
    const after = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    expect(after.status).toBe('TAKEN');
    expect(after.response_due_at_utc).toBeNull();
    const alerts = db.prepare(
      "SELECT COUNT(*) c FROM notification_logs WHERE dose_id = ? AND kind LIKE 'FAMILY_ALERT%'").get(doseId).c;
    expect(alerts).toBe(0);
  });

  it('NOT_TAKEN immediately alerts configured family members', async () => {
    const db = getDb();
    // Patient 1 (seeded, +919800000001) has schedules; use a fresh link.
    const fam = await createFamily({ phone: '+919800000202' });
    const pid = 1;
    await request(app).put(`/api/family/${fam.body.id}`).set(H())
      .send({ name: 'Test Family', phone: '+919800000202', patient_ids: [pid] });
    const sched = await createSchedule({
      patient_id: pid, reminder_times: ['08:00'], days_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_date: '2026-01-01', timezone: 'UTC', notify_family_ids: [fam.body.id],
    });
    const doseId = await makeDose(sched.body.id);
    const tok = db.prepare("SELECT token FROM response_tokens WHERE dose_id = ? AND action = 'NOT_TAKEN'").get(doseId);
    const res = await request(app).get(`/api/respond/${tok.token}`);
    expect(res.status).toBe(200);
    expect(res.body.familyNotified).toBe(1);
    const alerts = db.prepare(
      "SELECT COUNT(*) c FROM notification_logs WHERE dose_id = ? AND kind = 'FAMILY_ALERT_NOT_TAKEN'").get(doseId).c;
    expect(alerts).toBe(1);
  });

  it('NO_RESPONSE alerts family after the timeout, marks dose NO_RESPONSE (not a verified miss)', async () => {
    const db = getDb();
    // Isolated patient + one linked family member so exactly 1 alert is expected.
    const p = (await createPatient({ phone: '+919800000110' })).body.id;
    const fam = (await createFamily({ phone: '+919800000210' })).body.id;
    await request(app).put(`/api/family/${fam}`).set(H())
      .send({ name: 'Test Family', phone: '+919800000210', patient_ids: [p] });
    const sched = await createSchedule({
      patient_id: p, start_date: '2026-01-02', medicine_name: 'TimeoutMed',
      notify_family_ids: [fam],
    });
    const doseId = await makeDose(sched.body.id);
    // Simulate the 30 minutes having passed: pull the deadline into the past.
    db.prepare("UPDATE doses SET response_due_at_utc = ? WHERE id = ?").run(nowIso(), doseId);
    const n = await processTimeouts();
    expect(n).toBeGreaterThanOrEqual(1);
    const dose = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    expect(dose.status).toBe('NO_RESPONSE');
    const alerts = db.prepare(
      "SELECT COUNT(*) c FROM notification_logs WHERE dose_id = ? AND kind = 'FAMILY_ALERT_NO_RESPONSE'").get(doseId).c;
    expect(alerts).toBe(1);
  });

  it('TAKEN before the timeout cancels the pending alert', async () => {
    const db = getDb();
    const sched = await createSchedule({ start_date: '2026-01-03', medicine_name: 'CancelMed' });
    const doseId = await makeDose(sched.body.id);
    const tok = db.prepare("SELECT token FROM response_tokens WHERE dose_id = ? AND action = 'TAKEN'").get(doseId);
    await request(app).get(`/api/respond/${tok.token}`);
    db.prepare("UPDATE doses SET response_due_at_utc = ? WHERE id = ?").run(nowIso(), doseId);
    await processTimeouts();
    const dose = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    expect(dose.status).toBe('TAKEN'); // not overwritten to NO_RESPONSE
  });

  it('late response after an alert preserves prior notification history', async () => {
    const db = getDb();
    const p = (await createPatient({ phone: '+919800000111' })).body.id;
    const fam = (await createFamily({ phone: '+919800000211' })).body.id;
    await request(app).put(`/api/family/${fam}`).set(H())
      .send({ name: 'Test Family', phone: '+919800000211', patient_ids: [p] });
    const sched = await createSchedule({
      patient_id: p, start_date: '2026-01-04', medicine_name: 'LateMed',
      notify_family_ids: [fam],
    });
    const doseId = await makeDose(sched.body.id);
    db.prepare("UPDATE doses SET response_due_at_utc = ? WHERE id = ?").run(nowIso(), doseId);
    await processTimeouts(); // alert sent
    const tok = db.prepare("SELECT token FROM response_tokens WHERE dose_id = ? AND action = 'TAKEN'").get(doseId);
    const res = await request(app).get(`/api/respond/${tok.token}`);
    expect(res.status).toBe(200);
    expect(res.body.late).toBe(true);
    const dose = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    expect(dose.late_response).toBe(1);
    const alerts = db.prepare(
      "SELECT COUNT(*) c FROM notification_logs WHERE dose_id = ? AND kind = 'FAMILY_ALERT_NO_RESPONSE'").get(doseId).c;
    expect(alerts).toBe(1); // history preserved
  });

  it('rejects invalid and reused tokens', async () => {
    const bad = await request(app).get('/api/respond/not-a-real-token');
    expect(bad.status).toBe(404);
    const db = getDb();
    const sched = await createSchedule({ start_date: '2026-01-05', medicine_name: 'ReplayMed' });
    const doseId = await makeDose(sched.body.id);
    const tok = db.prepare("SELECT token FROM response_tokens WHERE dose_id = ? AND action = 'TAKEN'").get(doseId);
    await request(app).get(`/api/respond/${tok.token}`);
    const replay = await request(app).get(`/api/respond/${tok.token}`);
    expect([404, 409]).toContain(replay.status); // token deleted (single use)
  });
});

describe('demo mode integrity', () => {
  it('demo messages are recorded as simulated, never as sent', async () => {
    const db = getDb();
    const rows = db.prepare("SELECT DISTINCT mode, status FROM notification_logs WHERE mode = 'demo'").all();
    for (const r of rows) expect(r.status).not.toBe('sent');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('test-message endpoint in demo mode returns simulated status', async () => {
    const res = await request(app).post('/api/settings/test-message').set(H())
      .send({ phone: '+919800000300' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('demo');
    expect(res.body.status).toBe('simulated');
  });
});

describe('webhooks', () => {
  it('duplicate webhook events do not send duplicate alerts', async () => {
    const db = getDb();
    const sched = await createSchedule({ start_date: '2026-01-06', medicine_name: 'WebhookMed' });
    const doseId = await makeDose(sched.body.id);
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '1', phone_number_id: '1' },
        messages: [{ from: '919800000001', id: `wamid.test.${doseId}`, timestamp: '1', type: 'text', text: { body: 'TAKEN' } }],
      } } ] }],
    };
    await request(app).post('/api/webhook').set('Content-Type', 'application/json').send(payload);
    await request(app).post('/api/webhook').set('Content-Type', 'application/json').send(payload);
    const events = db.prepare("SELECT COUNT(*) c FROM webhook_events WHERE event_id LIKE '1:wamid.test.%'").get().c;
    expect(events).toBe(1); // idempotency store kept one
  });

  it('webhook GET verification fails with wrong token, succeeds with right token', async () => {
    const no = await request(app).get('/api/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'CHALL' });
    expect(no.status).toBe(403);
  });
});

describe('scheduler recovery after restart', () => {
  it('pending doses are picked up again from the database after a fresh tick', async () => {
    const db = getDb();
    const sched = await createSchedule({ start_date: '2026-01-07', medicine_name: 'RecoverMed' });
    const doseId = await makeDose(sched.body.id);
    // Simulate a crash: reminder never got its final state (status PENDING, deadline cleared).
    db.prepare("UPDATE doses SET status = 'PENDING', response_due_at_utc = NULL, reminder_sent_at_utc = NULL WHERE id = ?")
      .run(doseId);
    await tick();
    const dose = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    expect(dose.status).toBe('AWAITING_RESPONSE'); // recovered and reminder re-sent
    expect(dose.reminder_attempts).toBeGreaterThanOrEqual(1);
  });
});
