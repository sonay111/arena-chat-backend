import { pool } from "../db.js";

// One row per real event_status change — never the full odds/markets
// payload. See db-setup.ts for the schema and why this is a separate,
// much smaller table than raw_webhook_events.
export async function recordStatusTransition(matchId: string, from: string, to: string): Promise<void> {
  await pool.query(
    `INSERT INTO odds_status_transitions (match_id, from_status, to_status) VALUES ($1, $2, $3)`,
    [matchId, from, to]
  );
}
