# SAHAYAK architecture notes

## Workflow

```
Schedule (DB row: times, days, tz, timeout, family list)
   │  backend scheduler polls every 10 s
   ▼
doses row (UNIQUE schedule_id + scheduled_at_utc) ──► reminder sent (Cloud API or simulated)
   │                                                   │
   │                                   persist response_due_at_utc = now + timeout
   ▼
Patient response via single-use expiring token
   ├── TAKEN      → dose=TAKEN, deadline cleared, no family alert
   ├── NOT TAKEN  → dose=NOT_TAKEN, immediate alert to authorised family
   └── (nothing)  → backend timeout → dose=NO_RESPONSE (UNCONFIRMED), family alert
                                        │
                             late response still recorded, alert history preserved
```

## Reliability

- All timing state lives in the `doses` table (`status`, `response_due_at_utc`,
  `next_attempt_at_utc`), never in memory → restart-safe.
- Duplicate prevention: UNIQUE(schedule_id, scheduled_at_utc) on doses;
  partial UNIQUE(dose_id, kind, family_id) on family alerts; UNIQUE(dose_id, action)
  single-use response tokens; webhook_events idempotency table.
- Time zones via Luxon per schedule (DST-safe); timestamps stored as ISO-8601 UTC.

## Modes

- DEMO: no credentials; messages simulated and logged as status `simulated`.
- LIVE: official Cloud API (`POST /{version}/{phone-number-id}/messages`),
  real errors surfaced, 24-hour window enforced, template sends outside window.

## Security

- scrypt password hashing, DB-backed sessions, rate-limited login and public
  response endpoints, Zod validation, whitelisted template variables with HTML
  escaping, webhook signature verification, secrets only via environment.
