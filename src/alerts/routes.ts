import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { parseCountry } from "../activity/shared.js";

export const alertsRouter = Router();

// Same optional ?country=IN / ?country=unknown filter as GET
// /activity/recent, via the same LEFT JOIN + condition pattern and the
// same shared parseCountry() (src/activity/shared.ts) so the parsing
// rules can't drift between endpoints. The LEFT JOIN never drops rows on
// its own, so omitting `country` leaves behavior completely unchanged
// from before this filter existed.
const COUNTRY_FILTER_SQL = `(
  $1::text IS NULL
  OR ($1 = 'unknown' AND pl.country IS NULL)
  OR ($1 != 'unknown' AND pl.country = $1)
)`;

// Terminal outcomes seen in real traffic (see docs/tech-crm-webhooks.pdf +
// confirmed live 2026-09-11: rejected/failed/cancelled joined the original
// pending/completed pair). Anything else (pending, or an unrecognized future
// status) is treated as still-open and always shown — only a status in this
// list is subject to the RESOLVED_VISIBILITY_MINUTES cutoff below.
const RESOLVED_WITHDRAWAL_STATUSES = ["completed", "rejected", "failed", "cancelled"];

// How long a resolved withdrawal stays visible after resolving, so the
// frontend doesn't lose it off the list the instant it stops being pending.
const RESOLVED_VISIBILITY_MINUTES = 60;

// Reads persisted alerts (payments joined with their saved player_context
// snapshot) rather than calling the CRM again — the enrichment already
// happened once, at flag time, in withdrawal-delay-detector.ts.
//
// payments.updated_at can't tell us when a withdrawal resolved — real
// traffic never populates data.updatedAt (confirmed: it's always null), so
// that column is always null too. Instead, the LATERAL join below finds the
// most recent raw_webhook_events row for this payment id — since payments
// is upserted last-write-wins on every incoming event, that event's
// received_at IS effectively "when this payment's current status was set."
alertsRouter.get("/alerts/withdrawal-delays", async (req: Request, res: Response) => {
  const country = parseCountry(req.query.country);

  try {
    const { rows } = await pool.query(
      `SELECT p.id AS payment_id, p.user_id, p.amount, p.currency, p.status,
              p.created_at, p.updated_at, a.player_context, a.flagged_at,
              le.last_event_at
       FROM withdrawal_delay_alerts a
       JOIN payments p ON p.id = a.payment_id
       LEFT JOIN players pl ON pl.id = p.user_id
       LEFT JOIN LATERAL (
         SELECT max(rwe.received_at) AS last_event_at
         FROM raw_webhook_events rwe
         WHERE rwe.route IN ('/withdrawals', '/withdrawals/status-update')
           AND rwe.payload->'data'->>'_id' = p.id
       ) le ON true
       WHERE ${COUNTRY_FILTER_SQL}
         AND (
           NOT (p.status = ANY($2::text[]))
           OR le.last_event_at > now() - ($3 * INTERVAL '1 minute')
         )
       ORDER BY a.flagged_at DESC`,
      [country ?? null, RESOLVED_WITHDRAWAL_STATUSES, RESOLVED_VISIBILITY_MINUTES]
    );

    const alerts = rows.map((row) => ({
      paymentId: row.payment_id,
      userId: row.user_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      flaggedAt: row.flagged_at,
      // When this payment's status was last set — the same timestamp the
      // RESOLVED_VISIBILITY_MINUTES cutoff above is computed from. Not the
      // same as createdAt (when the withdrawal was first initiated) or
      // updatedAt (always null — see comment above the route).
      statusChangedAt: row.last_event_at,
      player: row.player_context,
    }));

    res.json({ alerts });
  } catch (err) {
    console.error("GET /alerts/withdrawal-delays failed:", err);
    res.status(500).json({ ok: false });
  }
});

// No CRM enrichment here, unlike withdrawal-delays — that endpoint reads a
// player_context snapshot captured once at flag time, but refresh-detection.ts
// doesn't do that enrichment step today, so adding it here would mean a live
// CRM call per row on every GET instead of a stored read. Keeping this plain
// for now; the raw alert data is enough to display.
alertsRouter.get("/alerts/refresh-detections", async (req: Request, res: Response) => {
  const country = parseCountry(req.query.country);

  try {
    const { rows } = await pool.query(
      `SELECT r.player_id, r.refresh_count, r.client_timestamp, r.received_at
       FROM refresh_alerts r
       LEFT JOIN players pl ON pl.id = r.player_id
       WHERE ${COUNTRY_FILTER_SQL}
       ORDER BY r.received_at DESC`,
      [country ?? null]
    );

    const detections = rows.map((row) => ({
      playerId: row.player_id,
      refreshCount: row.refresh_count,
      timestamp: row.client_timestamp,
      receivedAt: row.received_at,
    }));

    res.json({ detections });
  } catch (err) {
    console.error("GET /alerts/refresh-detections failed:", err);
    res.status(500).json({ ok: false });
  }
});
