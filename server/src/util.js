import crypto from 'node:crypto';

export function nowIso() { return new Date().toISOString(); }

/** Cryptographically secure random token (256 bits). */
export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Normalise phone to digits with leading +, e.g. "+919812345678".
 * If an Indian 10-digit number is provided without country code (e.g. 7987237184),
 * prepend +91 automatically.
 */
export function normalisePhone(raw) {
  let digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = '91' + digits.slice(1);
  } else if (digits.length === 10) {
    digits = '91' + digits;
  }
  return '+' + digits;
}

/** Basic E.164-ish validation: 8–15 digits after the +. */
export function isValidPhone(raw) {
  const p = normalisePhone(raw);
  return /^\+\d{8,15}$/.test(p);
}

/** Format phone for WhatsApp Click-to-Chat (wa.me) URL: digits only, country code required. */
export function toWhatsappPhone(raw) {
  const normalised = normalisePhone(raw);
  return normalised.replace(/[^\d]/g, '');
}

/** Generate a direct WhatsApp Click-to-Chat / wa.me deep-link URL. */
export function buildWhatsappUrl(phone, text = '') {
  const clean = toWhatsappPhone(phone);
  if (!clean) return '';
  const encoded = encodeURIComponent(String(text || '').trim());
  return encoded ? `https://wa.me/${clean}?text=${encoded}` : `https://wa.me/${clean}`;
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
