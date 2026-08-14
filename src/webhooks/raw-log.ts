import { pool } from "../db.js";

// Always call this FIRST, before touching players/wallets/payments/etc.
// These webhooks can retry, and the doc says the same delivery can arrive
// more than once — so if our parsing logic has a bug or hits a shape we
// didn't expect, the original payload is still safe here and can be
// reprocessed later.
//
// Deduped by eventId (when present): a retried delivery of the same event
// must not create a second row here. ON CONFLICT DO NOTHING against the
// partial unique index on event_id (see db-setup.ts) — rows with a null
// eventId (malformed bodies, or anything from before Satyam confirmed the
// envelope) never conflict with anything and always insert normally.
export async function logRawEvent(
  route: string,
  eventName: string | null,
  userId: string | null,
  eventId: string | null,
  payload: unknown
) {
  await pool.query(
    `INSERT INTO raw_webhook_events (route, event_name, event_id, user_id, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING`,
    [route, eventName, eventId, userId, JSON.stringify(payload)]
  );
}
