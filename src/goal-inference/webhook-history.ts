import { pool } from "../db.js";
import { CATEGORIES } from "../activity/shared.js";
import type { GoalInferenceWebhookHistory } from "./infer.js";

// Real engagement events, used to decide whether a bonus expired "unused"
// (no engagement in the ±1hr window around the expiry). Includes the three
// withdrawal terminal statuses confirmed live 2026-09-11 (rejected/failed/
// cancelled) — CATEGORIES.withdrawals in src/activity/shared.ts predates
// that and only lists initiated/completed/status_updated.
const ENGAGEMENT_EVENT_TYPES = [
  ...CATEGORIES.deposits,
  ...CATEGORIES.withdrawals,
  "withdrawal.rejected",
  "withdrawal.failed",
  "withdrawal.cancelled",
  ...CATEGORIES.bets,
];

const BONUS_RECENCY_DAYS = 7;
const ACTIVITY_RECENCY_DAYS = 30;

// Builds the webhookHistory half of GoalInferenceInput from our own
// persisted webhook data — the CRM-data half (GoalInferencePlayer) comes
// separately from getPlayerContext(), which the caller is responsible for
// (see src/goal-inference/routes.ts).
export async function buildWebhookHistory(userId: string): Promise<GoalInferenceWebhookHistory> {
  const pendingWithdrawalRes = await pool.query<{ id: string; amount: string }>(
    `SELECT id, amount FROM payments
     WHERE user_id = $1 AND payment_type = 'withdrawal' AND status = 'pending'
     ORDER BY received_at DESC LIMIT 1`,
    [userId]
  );
  const pendingWithdrawal = pendingWithdrawalRes.rows[0]
    ? { paymentId: pendingWithdrawalRes.rows[0].id, amount: Number(pendingWithdrawalRes.rows[0].amount) }
    : null;

  const refreshRes = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM raw_webhook_events
     WHERE event_name = 'player.refresh_detected' AND user_id = $1 AND received_at > now() - interval '1 hour'`,
    [userId]
  );
  const refreshIncidentsLastHour = refreshRes.rows[0].c;

  const bonusExpiredRes = await pool.query<{ received_at: Date }>(
    `SELECT received_at FROM raw_webhook_events WHERE event_name = 'bonus.expired' AND user_id = $1`,
    [userId]
  );
  let bonusExpiredUnusedInWindow = false;
  let bonusExpiredWithinLast7Days = false;
  for (const row of bonusExpiredRes.rows) {
    const otherActivity = await pool.query(
      `SELECT 1 FROM raw_webhook_events
       WHERE user_id = $1 AND event_name = ANY($2)
         AND received_at BETWEEN $3::timestamptz - interval '1 hour' AND $3::timestamptz + interval '1 hour'
       LIMIT 1`,
      [userId, ENGAGEMENT_EVENT_TYPES, row.received_at]
    );
    if (otherActivity.rowCount === 0) {
      bonusExpiredUnusedInWindow = true;
      if (row.received_at.getTime() > Date.now() - BONUS_RECENCY_DAYS * 24 * 60 * 60 * 1000) {
        bonusExpiredWithinLast7Days = true;
      }
    }
  }

  const otherActivity30dRes = await pool.query(
    `SELECT 1 FROM raw_webhook_events
     WHERE user_id = $1 AND event_name != 'bonus.expired'
       AND received_at > now() - ($2 * INTERVAL '1 day')
     LIMIT 1`,
    [userId, ACTIVITY_RECENCY_DAYS]
  );
  const hasOtherActivityLast30Days = (otherActivity30dRes.rowCount ?? 0) > 0;

  const registeredRes = await pool.query(
    `SELECT 1 FROM raw_webhook_events WHERE event_name = 'user.registered' AND user_id = $1 LIMIT 1`,
    [userId]
  );
  const registered = (registeredRes.rowCount ?? 0) > 0;

  const depositsRes = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM payments WHERE user_id = $1 AND payment_type = 'deposit' AND status = 'completed'`,
    [userId]
  );
  const totalDepositsEver = depositsRes.rows[0].c;

  return {
    pendingWithdrawal,
    refreshIncidentsLastHour,
    bonusExpiredUnusedInWindow,
    bonusExpiredWithinLast7Days,
    hasOtherActivityLast30Days,
    registered,
    totalDepositsEver,
  };
}
