import express, { Router } from "express";
import { pool } from "../db.js";
import { logRawEvent } from "./raw-log.js";
import { upsertPlayerCore } from "./players.js";
import { upsertWallets } from "./wallets.js";

export const paymentsRouter = Router();

// /deposits, /deposits/status-update, /withdrawals, /withdrawals/status-update
// all send the same shape of payment document — the body's own
// "paymentType" field says deposit vs withdrawal, and "event" says which
// lifecycle stage. So one handler covers all four routes; routePath is only
// used for the raw event log.
async function handlePaymentWebhook(routePath: string, req: express.Request, res: express.Response) {
  const body = req.body;
  try {
    await logRawEvent(routePath, body.event ?? null, body.userId ?? null, body);

    if (body.user) await upsertPlayerCore(body.user);
    if (Array.isArray(body.wallet)) await upsertWallets(body.wallet);

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
        body._id,
        body.userId,
        body.paymentType ?? null,
        body.type ?? null,
        body.payment_method ?? null,
        body.reference_no ?? null,
        body.amount ?? null,
        body.currency ?? null,
        body.status ?? null,
        body.payment_status ?? null,
        body.approval_status ?? null,
        body.screenshot ?? null,
        body.is_reapproved ?? null,
        body.payment_id ?? null,
        body.ip ?? null,
        body.is_chargedback ?? null,
        body.is_wegered ?? null,
        body.gateway ?? null,
        body.network_fee ?? null,
        body.payment_data ? JSON.stringify(body.payment_data) : null,
        body.bank_id ?? null,
        body.remark ?? null,
        body.createdAt ?? null,
        body.updatedAt ?? null,
      ]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`${routePath} webhook failed:`, err);
    res.status(500).json({ ok: false });
  }
}

paymentsRouter.post("/deposits", express.json(), (req, res) => handlePaymentWebhook("/deposits", req, res));
paymentsRouter.post("/deposits/status-update", express.json(), (req, res) => handlePaymentWebhook("/deposits/status-update", req, res));
paymentsRouter.post("/withdrawals", express.json(), (req, res) => handlePaymentWebhook("/withdrawals", req, res));
paymentsRouter.post("/withdrawals/status-update", express.json(), (req, res) => handlePaymentWebhook("/withdrawals/status-update", req, res));
