import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.join(__dirname, '..');
export const PROJECT_ROOT = path.join(SERVER_ROOT, '..');

const env = (key, fallback = '') => process.env[key] ?? fallback;

export const config = {
  port: Number(env('PORT', '4000')),
  dbPath: env('DB_PATH') || path.join(PROJECT_ROOT, 'database', 'sahayak.db'),
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: env('ADMIN_PASSWORD', 'sahayak123'),
  sessionTtlHours: Number(env('SESSION_TTL_HOURS', '12')),
  schedulerIntervalMs: Number(env('SCHEDULER_INTERVAL_MS', '10000')),
  maxReminderAttempts: Number(env('MAX_REMINDER_ATTEMPTS', '3')),
  retryBackoffSeconds: Number(env('RETRY_BACKOFF_SECONDS', '60')),
  publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:4000'),
  defaultWhatsappPhone: env('DEFAULT_WHATSAPP_PHONE', '+917987237184'),
  whatsapp: {
    accessToken: env('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    wabaId: env('WHATSAPP_BUSINESS_ACCOUNT_ID'),
    graphVersion: env('WHATSAPP_GRAPH_API_VERSION', 'v22.0'),
    verifyToken: env('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
    appSecret: env('WHATSAPP_APP_SECRET'),
  },
};

export function whatsappConfigured(wa = config.whatsapp) {
  return Boolean(wa.accessToken && wa.phoneNumberId);
}
