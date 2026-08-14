import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { upsertPlayerCore } from "./players.js";
import { upsertWallets } from "./wallets.js";

export const bonusesRouter = Router();

// The doc's four bonus examples don't share a "type" field, so we infer it
// from which fields are present. This only covers the four documented
// local-doc types — "free spin (provider)" is synthetic with no local doc
// per the spec, so it won't match any of these and comes through as null.
function inferBonusType(data: any): string | null {
  if (data.rewardType === "freebet") return "free_bet";
  if (data.spin_id) return "free_spin";
  if (data.bonus_id && data.name) return "deposit_bonus";
  if (data.admin_id) return "cashback";
  return null;
}

// OLDER ASSUMED FORMAT (flat, no envelope) — kept for reference in case the
// envelope guess turns out wrong and this needs reverting. Under the old
// assumption trigger_type was always null: the doc said the trigger type
// (bonus.activated / bonus.expired) was "known by source flow" but never
// present in the body, and there was no other field to derive it from. The
// body was read directly off req.body, and raw logging happened per-route
// right here:
//
//   bonusesRouter.post("/bonuses", express.json(), async (req, res) => {
//     const body = req.body;
//     const userId = body.userId ?? body.user_id ?? null;
//     await logRawEvent("/bonuses", null, userId, body);
//     if (body.user) await upsertPlayerCore(body.user);
//     if (Array.isArray(body.wallet)) await upsertWallets(body.wallet);
//     await pool.query(`INSERT INTO bonuses (...) VALUES (...) ...`, [
//       body._id, userId, inferBonusType(body), null /* trigger_type */, ...
//     ]);
//     ...
//   });
//
// Confirmed with Satyam: the real shape is an envelope — {event, eventId,
// timestamp, data}. This actually resolves that open question: `event` IS
// exactly the "known by source flow" signal the doc referred to —
// "bonus.activated" or "bonus.expired" — so trigger_type is no longer
// always null. Raw logging now happens once, globally, in envelope.ts.
bonusesRouter.post("/bonuses", async (req, res) => {
  const envelope = req.webhookEnvelope;
  const data = envelope?.data;
  if (!data) {
    return res.status(400).json({ ok: false });
  }

  // Free bet / free spin payloads use "userId"; deposit % bonus / cashback
  // use "user_id". Normalize here since the bonuses table has one column.
  const userId = data.userId ?? data.user_id ?? null;

  try {
    if (data.user) await upsertPlayerCore(data.user);
    if (Array.isArray(data.wallet)) await upsertWallets(data.wallet);

    await pool.query(
      `INSERT INTO bonuses (id, user_id, bonus_type, trigger_type, status, currency, created_at, updated_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         user_id      = EXCLUDED.user_id,
         bonus_type   = EXCLUDED.bonus_type,
         trigger_type = EXCLUDED.trigger_type,
         status       = EXCLUDED.status,
         currency     = EXCLUDED.currency,
         updated_at   = EXCLUDED.updated_at,
         payload      = EXCLUDED.payload`,
      [
        data._id,
        userId,
        inferBonusType(data),
        envelope.event ?? null,
        data.status ?? null,
        data.currency ?? null,
        data.createdAt ?? null,
        data.updatedAt ?? null,
        JSON.stringify(data),
      ]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("/bonuses webhook failed:", err);
    res.status(500).json({ ok: false });
  }
});
