import crypto from 'node:crypto';

export function nowIso() { return new Date().toISOString(); }

/** Cryptographically secure random token (256 bits). */
export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Normalise phone to digits with leading +, e.g. "+919812345678". */
export function normalisePhone(raw) {
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits ? '+' + digits : '';
}

/** Basic E.164-ish validation: 8–15 digits after the +. */
export function isValidPhone(raw) {
  const p = normalisePhone(raw);
  return /^\+\d{8,15}$/.test(p);
}

/**
 * Render a message template body safely.
 * Only whitelisted {{variables}} are substituted; every value is
 * escaped for HTML, and unknown/unsafe {{...}} constructs are removed,
 * which prevents template injection.
 */
export function renderTemplate(body, values) {
  const allowed = ['patient_name', 'medicine_name', 'dosage', 'scheduled_time',
    'response_status', 'response_time'];
  let out = String(body);
  for (const key of allowed) {
    const esc = String(values?.[key] ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    out = out.split(`{{${key}}}`).join(esc);
  }
  // Remove any remaining {{ ... }} (unknown or malicious variables).
  out = out.replace(/\{\{[^}]*\}\}/g, '');
  return out;
}

export function templateVariables(body) {
  const found = String(body).match(/\{\{\s*([a-z_]+)\s*\}\}/g) || [];
  return [...new Set(found.map(s => s.replace(/[{}\s]/g, '')))];
}

export function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}
