import { getDb, nowIso, setSetting, getSetting } from './db.js';
import { whatsappConfigured, config } from './config.js';
import { renderTemplate } from './util.js';

/**
 * WhatsApp messaging layer.
 *
 * - DEMO mode (no credentials): simulated messages, clearly labelled,
 *   never claims a real send.
 * - LIVE mode (WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID set):
 *   official Meta WhatsApp Cloud API. Real failures surface as errors.
 *
 * Live-mode free-form text is only allowed inside the 24-hour
 * customer-service window (tracked via inbound_sessions). Outside that
 * window live sends use an approved template payload shape when the
 * caller passes a template name, otherwise the send fails safely with
 * an explanatory error (never a fake success).
 */

export function getMode() {
  return whatsappConfigured() ? 'live' : 'demo';
}

export function integrationStatus() {
  const wa = config.whatsapp;
  return {
    mode: getMode(),
    accessTokenPresent: Boolean(wa.accessToken),
    phoneNumberIdPresent: Boolean(wa.phoneNumberId),
    wabaIdPresent: Boolean(wa.wabaId),
    webhookVerifyTokenPresent: Boolean(wa.verifyToken),
    appSecretPresent: Boolean(wa.appSecret),
    graphVersion: wa.graphVersion,
  };
}

/** Record an inbound WhatsApp message (24h service window tracking). */
export function recordInbound(phone) {
  getDb().prepare(
    `INSERT INTO inbound_sessions (phone, last_inbound_at_utc) VALUES (?, ?)
     ON CONFLICT(phone) DO UPDATE SET last_inbound_at_utc = excluded.last_inbound_at_utc`
  ).run(phone, nowIso());
}

export function withinServiceWindow(phone) {
  const row = getDb().prepare('SELECT last_inbound_at_utc FROM inbound_sessions WHERE phone = ?').get(phone);
  if (!row) return false;
  return (Date.now() - new Date(row.last_inbound_at_utc).getTime()) < 24 * 3600_000;
}

async function sendLiveText(phone, text, templateName) {
  const wa = config.whatsapp;
  const url = `https://graph.facebook.com/${wa.graphVersion}/${wa.phoneNumberId}/messages`;
  const inWindow = withinServiceWindow(phone);

  let payload;
  if (templateName && !inWindow) {
    // Outside the 24-hour window, Meta only permits approved template messages.
    payload = {
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: { name: templateName, language: { code: 'en' } },
    };
  } else if (!inWindow) {
    throw new Error(
      'LIVE send blocked: this recipient is outside the 24-hour WhatsApp customer-service window, ' +
      'and no approved template name was provided. Free-form text messages are not permitted by Meta. ' +
      'The message was NOT sent.');
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'text',
      text: { body: text },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${wa.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`WhatsApp Cloud API error: ${msg}`);
  }
  return data?.messages?.[0]?.id ?? null;
}

/**
 * Send a message and record the attempt in notification_logs.
 * Returns { messageId, status, mode, error }.
 * In DEMO mode status is 'simulated'; it is NEVER 'sent'.
 */
export async function sendMessage({ phone, body, kind, doseId = 0, patientId = 0, familyId = 0, templateName = null }) {
  const db = getDb();
  const mode = getMode();
  const rendered = renderTemplate(body, {});
  let messageId = null, status = 'pending', error = null;

  if (mode === 'demo') {
    messageId = `sim.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    status = 'simulated';
    console.log(`[whatsapp:demo] ${kind} -> ${phone}: ${rendered.slice(0, 120)}`);
  } else {
    try {
      messageId = await sendLiveText(phone, rendered, templateName);
      status = 'sent';
    } catch (e) {
      status = 'failed';
      error = e.message;
      console.error(`[whatsapp:live] ${kind} -> ${phone} FAILED: ${e.message}`);
    }
  }

  const info = db.prepare(
    `INSERT INTO notification_logs (dose_id, patient_id, family_id, kind, recipient_phone,
       message_id, status, error, mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(doseId, patientId, familyId, kind, phone, messageId, status, error, mode, nowIso());

  return { logId: Number(info.lastInsertRowid), messageId, status, mode, error };
}

/** Update delivery/read/failed status from a Meta webhook status event. */
export function updateMessageStatus(messageId, status, timestamp) {
  if (!messageId || !status) return;
  const db = getDb();
  const map = { delivered: 'delivered', read: 'read', failed: 'failed', sent: 'sent' };
  if (!map[status]) return;
  db.prepare('UPDATE notification_logs SET status = ? WHERE message_id = ?')
    .run(map[status], messageId);
}

/** Connection test used by the Settings page. */
export async function testConnection() {
  if (getMode() === 'demo') {
    return { ok: true, mode: 'demo', detail: 'Running in DEMO mode — messages are simulated, no external calls are made.' };
  }
  const wa = config.whatsapp;
  const url = `https://graph.facebook.com/${wa.graphVersion}/${wa.phoneNumberId}?fields=verified_name,display_phone_number&access_token=${encodeURIComponent(wa.accessToken)}`;
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, mode: 'live', detail: data?.error?.message || `HTTP ${res.status}` };
    return { ok: true, mode: 'live', detail: `Connected to "${data.verified_name}" (${data.display_phone_number})` };
  } catch (e) {
    return { ok: false, mode: 'live', detail: e.message };
  }
}
