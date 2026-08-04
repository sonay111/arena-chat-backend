import { pool } from "../db.js";

// Always call this FIRST, before touching players/wallets/payments/etc.
// These webhooks are fire-and-forget with no retries, so if our parsing
// logic has a bug or hits a shape we didn't expect, the original payload
// is still safe here and can be reprocessed later.
export async function logRawEvent(
  route: string,
  eventName: string | null,
  userId: string | null,
  payload: unknown
) {
  await pool.query(
    `INSERT INTO raw_webhook_events (route, event_name, user_id, payload)
     VALUES ($1, $2, $3, $4)`,
    [route, eventName, userId, JSON.stringify(payload)]
  );
}
