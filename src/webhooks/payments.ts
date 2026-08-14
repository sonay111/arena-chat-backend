import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { upsertPlayerCore } from "./players.js";
import { upsertWallets } from "./wallets.js";

export const paymentsRouter = Router();

// /deposits, /deposits/status-update, /withdrawals, /withdrawals/status-update
// all send the same shape of payment document — the data's own
// "paymentType" field says deposit vs withdrawal. So one handler covers
// all four routes; routePath is only used for the error log message.
//
// OLDER ASSUMED FORMAT (flat, no envelope) — kept for reference in case the
// envelope guess turns out wrong and this needs reverting. Under the old
// assumption this read straight off req.body (the route's own
// express.json()), and did its own raw logging per-route:
//
//   async function handlePaymentWebhook(routePath, req, res) {
//     const body = req.body;
//     await logRawEvent(routePath, body.event ?? null, body.userId ?? null, body);
//     if (body.user) await upsertPlayerCore(body.user);
//     if (Array.isArray(body.wallet)) await upsertWallets(body.wallet);
//     await pool.query(`INSERT INTO payments (...) VALUES (...) ...`, [
//       body._id, body.userId, body.paymentType, ...
//     ]);
//     ...
//   }
//   paymentsRouter.post("/deposits", express.json(), (req, res) => handlePaymentWebhook("/deposits", req, res));
//
// Confirmed with Satyam: the real shape is an envelope — {event, eventId,
// timestamp, data} — and `data` holds what used to be the body root. Raw
// logging now happens once, globally, in envelope.ts — not per-route.
async function handlePaymentWebhook(routePath: string, req: Request, res: Response) {
  const data = req.webhookEnvelope?.data;
  if (!data) {
    return res.status(400).json({ ok: false });
  }

  try {
    if (data.user) await upsertPlayerCore(data.user);
    if (Array.isArray(data.wallet)) await upsertWallets(data.wallet);

    await pool.query(
      `INSERT INTO payments (
         id, user_id, payment_type, type, payment_method, reference_no, amount,
         currency, status, payment_status, approval_status, screenshot, is_reapproved,
         payment_id, ip, is_chargedback, is_wegered, gateway,
         network_fee, payment_data, bank_id, remark, created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (id) DO UPDATE SET
         user_id         = EXCLUDED.user_id,
         payment_type    = EXCLUDED.payment_type,
         type            = EXCLUDED.type,
         payment_method  = EXCLUDED.payment_method,
         reference_no    = EXCLUDED.reference_no,
         amount          = EXCLUDED.amount,
         currency        = EXCLUDED.currency,
         status          = EXCLUDED.status,
         payment_status  = EXCLUDED.payment_status,
         approval_status = EXCLUDED.approval_status,
         screenshot      = EXCLUDED.screenshot,
         is_reapproved   = EXCLUDED.is_reapproved,
         payment_id      = EXCLUDED.payment_id,
         ip              = EXCLUDED.ip,
         is_chargedback  = EXCLUDED.is_chargedback,
         is_wegered      = EXCLUDED.is_wegered,
         gateway         = EXCLUDED.gateway,
         network_fee     = EXCLUDED.network_fee,
         payment_data    = EXCLUDED.payment_data,
         bank_id         = EXCLUDED.bank_id,
         remark          = EXCLUDED.remark,
         updated_at      = EXCLUDED.updated_at`,
      [
        data._id,
        data.userId,
        data.paymentType ?? null,
        data.type ?? null,
        data.payment_method ?? null,
        data.reference_no ?? null,
        data.amount ?? null,
        data.currency ?? null,
        data.status ?? null,
        data.payment_status ?? null,
        data.approval_status ?? null,
        data.screenshot ?? null,
        data.is_reapproved ?? null,
        data.payment_id ?? null,
        data.ip ?? null,
        data.is_chargedback ?? null,
        data.is_wegered ?? null,
        data.gateway ?? null,
        data.network_fee ?? null,
        data.payment_data ? JSON.stringify(data.payment_data) : null,
        data.bank_id ?? null,
        data.remark ?? null,
        data.createdAt ?? null,
        data.updatedAt ?? null,
      ]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`${routePath} webhook failed:`, err);
    res.status(500).json({ ok: false });
  }
}

paymentsRouter.post("/deposits", (req, res) => handlePaymentWebhook("/deposits", req, res));
paymentsRouter.post("/deposits/status-update", (req, res) => handlePaymentWebhook("/deposits/status-update", req, res));
paymentsRouter.post("/withdrawals", (req, res) => handlePaymentWebhook("/withdrawals", req, res));
paymentsRouter.post("/withdrawals/status-update", (req, res) => handlePaymentWebhook("/withdrawals/status-update", req, res));
