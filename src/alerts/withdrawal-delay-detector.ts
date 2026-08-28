import { pool } from "../db.js";
import { getPlayerContext } from "../crm/index.js";
import type { PlayerContext } from "../crm/index.js";

export const DELAY_THRESHOLD_MINUTES = 10;

export type WithdrawalDelayAlert = {
  paymentId: string;
  userId: string;
  player: PlayerContext;
};

// Checks for withdrawals stuck past DELAY_THRESHOLD_MINUTES and not yet
// completed, enriches each newly-found one with CRM player data, and
// persists the combined alert so GET /alerts/withdrawal-delays doesn't need
// to call the CRM again.
//
// fetchPlayerContext is injectable so tests can stub it out — real CRM
// calls fail with CrmIpNotAllowedError until our server's IP is
// allowlisted (see src/crm/errors.ts).
//
// Order matters: a withdrawal is only marked flagged_delayed=true AFTER its
// player context has been fetched and saved. If the CRM lookup fails right
// now (the expected current state), the row is left unflagged so the next
// run retries it — flagging first would silently drop the alert forever.
export async function checkWithdrawalDelays(
  fetchPlayerContext: (userId: string) => Promise<PlayerContext> = getPlayerContext
): Promise<WithdrawalDelayAlert[]> {
  const { rows: candidates } = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id
     FROM payments
     WHERE payment_type = 'withdrawal'
       AND flagged_delayed = false
       AND status IS DISTINCT FROM 'completed'
       AND created_at < now() - ($1 * INTERVAL '1 minute')`,
    [DELAY_THRESHOLD_MINUTES]
  );

  const alerts: WithdrawalDelayAlert[] = [];

  for (const candidate of candidates) {
    let player: PlayerContext;
    try {
      player = await fetchPlayerContext(candidate.user_id);
    } catch (err) {
      console.error(
        `withdrawal-delay: CRM lookup failed for user ${candidate.user_id}, will retry next check:`,
        err
      );
      continue;
    }

    // Guards against double-flagging if a run ever overlaps the previous one.
    const { rows: updated } = await pool.query(
      `UPDATE payments SET flagged_delayed = true WHERE id = $1 AND flagged_delayed = false RETURNING id`,
      [candidate.id]
    );
    if (updated.length === 0) continue;

    await pool.query(
      `INSERT INTO withdrawal_delay_alerts (payment_id, player_context)
       VALUES ($1, $2)
       ON CONFLICT (payment_id) DO NOTHING`,
      [candidate.id, JSON.stringify(player)]
    );

    alerts.push({ paymentId: candidate.id, userId: candidate.user_id, player });
  }

  return alerts;
}

export function startWithdrawalDelayCheck(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    checkWithdrawalDelays().catch((err) => {
      console.error("withdrawal-delay: scheduled check failed:", err);
    });
  }, intervalMs);
}
