import { pool } from "../db.js";

// Atomically claims a messageId as "seen". INSERT ... ON CONFLICT DO
// NOTHING means only the first caller to insert a given id gets rowCount 1
// (safe to process); every retry after that gets rowCount 0 (already
// processed — skip the handler, but the caller still acks 200 so the
// sender stops retrying). Backed by Postgres, not an in-memory Set, so
// dedup survives a server restart.
export async function claimMessageId(messageId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO support_chat_processed_messages (message_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [messageId]
  );
  return rowCount === 1;
}
