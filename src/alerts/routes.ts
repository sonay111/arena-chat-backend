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

// Reads persisted alerts (payments joined with their saved player_context
// snapshot) rather than calling the CRM again — the enrichment already
// happened once, at flag time, in withdrawal-delay-detector.ts.
alertsRouter.get("/alerts/withdrawal-delays", async (req: Request, res: Response) => {
  const country = parseCountry(req.query.country);

  try {
    const { rows } = await pool.query(
      `SELECT p.id AS payment_id, p.user_id, p.amount, p.currency, p.status,
              p.created_at, p.updated_at, a.player_context, a.flagged_at
       FROM withdrawal_delay_alerts a
       JOIN payments p ON p.id = a.payment_id
       LEFT JOIN players pl ON pl.id = p.user_id
       WHERE ${COUNTRY_FILTER_SQL}
       ORDER BY a.flagged_at DESC`,
      [country ?? null]
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
