# Going LIVE with the official WhatsApp Cloud API

This guide covers everything needed to move SAHAYAK from DEMO mode (simulated messages) to LIVE mode (real WhatsApp messages via Meta's official WhatsApp Cloud API).

## 1. Prerequisites

- A [Meta developer account](https://developers.facebook.com).
- A WhatsApp Business app (My Apps → Create App → **Business** type → add the **WhatsApp** product).
- The dashboard gives you a temporary access token (24 h), a **Phone number ID**, and a test phone number. For long-running use, generate a **permanent System User token** in Meta Business Settings.

## 2. Fill in server/.env

```env
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=102290129340398
WHATSAPP_GRAPH_API_VERSION=v22.0
WHATSAPP_WEBHOOK_VERIFY_TOKEN=pick-your-own-random-string
WHATSAPP_APP_SECRET=...   (App settings → Basic)
PUBLIC_BASE_URL=https://your-tunnel.ngrok.app
```

Restart the backend. The sidebar badge switches to **LIVE mode**.

## 3. Verify the connection

Settings & Integrations → **Test connection** (queries your phone number's verified name via `GET /{version}/{phone-number-id}`), then **Send test message** after explicit confirmation.

## 4. Message templates and the 24-hour window

Meta rules implemented in SAHAYAK:

- Within **24 hours** of the recipient's last inbound message, free-form text is allowed.
- Outside that window, only **approved template messages** may be sent. SAHAYAK refuses to send free-form text outside the window (fails safely with an explanation) and supports sending a named approved template (`templateName`).
- Reminder/interactive button usage depends on your template approvals — manage and approve templates in **Meta Business Manager → WhatsApp → Message templates**. SAHAYAK's in-app Message Templates page controls the *content and variables*; approval status lives in Meta's dashboard.

## 5. Webhooks for replies and delivery status

1. Run a tunnel: `ngrok http 4000`.
2. Meta App dashboard → WhatsApp → Configuration → Webhook → Edit:
   - Callback URL: `https://<tunnel>/api/webhook`
   - Verify token: exactly `WHATSAPP_WEBHOOK_VERIFY_TOKEN` from `.env`
   - Subscribe to the **messages** field.
3. SAHAYAK handles:
   - `GET /api/webhook` verification (`hub.mode`, `hub.verify_token`, `hub.challenge`).
   - `POST /api/webhook` with `X-Hub-Signature-256` HMAC-SHA256 verification.
   - Patient replies **TAKEN** / **NOT TAKEN** (text or interactive button) → matched to their newest awaiting dose and processed through the same secure workflow as links.
   - `statuses` events → delivery/read/failed updates on the notification log.
   - Duplicate webhook event ids → stored once, processed once.

## 6. Making reminder links reachable from a phone

TAKEN / NOT TAKEN links use `PUBLIC_BASE_URL`. On localhost a phone cannot open them; with the tunnel URL in `PUBLIC_BASE_URL` they work from any phone. Free tunnel URLs rotate between restarts — update `.env` after each ngrok restart, or use a static domain.

## 7. Costs and limits

Meta pricing is per-conversation (category-based). The test number can only message numbers registered as recipients in the dashboard. Check the current pricing/limits in Meta's documentation.
