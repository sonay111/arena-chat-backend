import { pool } from "../db.js";
import { getPlayerContextAnyBrand } from "../crm/index.js";
import type { PlayerContext } from "../crm/index.js";

export const DELAY_THRESHOLD_MINUTES = 2;

export type WithdrawalDelayAlert = {
  paymentId: string;
  userId: string;
  player: PlayerContext | null;
};

// Checks for withdrawals stuck past DELAY_THRESHOLD_MINUTES and not yet
// completed, enriches each newly-found one with CRM player data, and
// persists the combined alert so GET /alerts/withdrawal-delays doesn't need
// to call the CRM again.
//
// fetchPlayerContext is injectable so tests can stub it out — real CRM
// calls fail with CrmIpNotAllowedError until our server's IP is
// allowlisted (see src/crm/errors.ts). Defaults to getPlayerContextAnyBrand
// (not getPlayerContext directly) since withdrawal webhooks carry no brand
// signal — see src/crm/player-context.ts for the CrazyBet-then-Arena365
// fallback this performs.
//
// CRM enrichment is best-effort, not required to flag: a withdrawal is
// flagged (and alerted) even if CRM lookup fails, with player left null.
// This used to block flagging entirely so the next run would retry — but
// a CrazyBet userId will NEVER exist in Arena365's CRM (confirmed by
// Satyam, 2026-09-30 investigation), so for CrazyBet withdrawals retrying
// forever was not "waiting out a transient failure," it was permanently
// never flagging at all, which also meant the planned Pay777 messaging
// wire-up could never fire. Flagging immediately does mean a withdrawal
// hit by a genuinely transient Arena365 CRM failure (e.g. CrmIpNotAllowedError)
// now gets player: null permanently too, instead of eventually getting
// real enrichment on a later retry — a real trade-off, not a free fix.
export async function checkWithdrawalDelays(
  fetchPlayerContext: (userId: string) => Promise<PlayerContext> = getPlayerContextAnyBrand
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
    let player: PlayerContext | null;
    try {
      player = await fetchPlayerContext(candidate.user_id);
    } catch (err) {
      console.error(
        `withdrawal-delay: CRM lookup failed for user ${candidate.user_id}, flagging without enrichment:`,
        err
      );
      player = null;
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
