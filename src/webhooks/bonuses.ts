import express, { Router } from "express";
import { pool } from "../db.js";
import { logRawEvent } from "./raw-log.js";
import { upsertPlayerCore } from "./players.js";
import { upsertWallets } from "./wallets.js";

export const bonusesRouter = Router();

// The doc's four bonus examples don't share a "type" field, so we infer it
// from which fields are present. This only covers the four documented
// local-doc types — "free spin (provider)" is synthetic with no local doc
// per the spec, so it won't match any of these and comes through as null.
function inferBonusType(body: any): string | null {
  if (body.rewardType === "freebet") return "free_bet";
  if (body.spin_id) return "free_spin";
  if (body.bonus_id && body.name) return "deposit_bonus";
  if (body.admin_id) return "cashback";
  return null;
}

bonusesRouter.post("/bonuses", express.json(), async (req, res) => {
  const body = req.body;
  // Free bet / free spin payloads use "userId"; deposit % bonus / cashback
  // use "user_id". Normalize here since the bonuses table has one column.
  const userId = body.userId ?? body.user_id ?? null;

  try {
    // event_name is null here on purpose — per the doc, /bonuses doesn't
    // carry an event field in the body at all; the trigger type
    // (bonus.activated / bonus.expired) is only known "by source flow" on
    // the platform's side, and the doc doesn't say how (or whether) that
    // reaches us. Ask Satyam how to distinguish activated vs expired before
    // relying on trigger_type below — for now it's always null.
    await logRawEvent("/bonuses", null, userId, body);

    if (body.user) await upsertPlayerCore(body.user);
    if (Array.isArray(body.wallet)) await upsertWallets(body.wallet);

    await pool.query(
      `INSERT INTO bonuses (id, user_id, bonus_type, trigger_type, status, currency, created_at, updated_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         user_id    = EXCLUDED.user_id,
         bonus_type = EXCLUDED.bonus_type,
         status     = EXCLUDED.status,
         currency   = EXCLUDED.currency,
         updated_at = EXCLUDED.updated_at,
         payload    = EXCLUDED.payload`,
      [
        body._id,
        userId,
        inferBonusType(body),
        null, // trigger_type — see comment above
        body.status ?? null,
        body.currency ?? null,
        body.createdAt ?? null,
        body.updatedAt ?? null,
        JSON.stringify(body),
      ]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("/bonuses webhook failed:", err);
    res.status(500).json({ ok: false });
  }
});
