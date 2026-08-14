import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { upsertPlayerCore } from "./players.js";
import { upsertWallets } from "./wallets.js";

export const betsRouter = Router();

type BetRow = {
  id: string;
  user_id: string;
  category: "sportsbook" | "casino";
  amount: number | null;
  return_amount: number | null;
  status: string | null;
  bet_type: string | null;
  currency: string | null;
  match_id: string | null;
  market_id: string | null;
  market_name: string | null;
  result_string: string | null;
  team_name: string | null;
  bet_title: string | null;
  bet_name: string | null;
  tournament_name: string | null;
  outcome_id: string | null;
  sports_type: string | null;
  device_type: string | null;
  user_ip: string | null;
  bet_status: string | null;
  wallet_id: string | null;
  game_code: string | null;
  developer_code: string | null;
  bet_with_bonus: boolean | null;
  transaction_id: string | null;
  debit_transaction_id: string | null;
  credit_transaction_id: string | null;
  round: string | null;
  session: string | null;
  created_at: string | null;
  updated_at: string | null;
};

async function upsertBet(row: BetRow) {
  await pool.query(
    `INSERT INTO bets (
       id, user_id, category, amount, return_amount, status, bet_type, currency,
       match_id, market_id, market_name, result_string, team_name, bet_title,
       bet_name, tournament_name, outcome_id, sports_type, device_type, user_ip,
       bet_status, wallet_id,
       game_code, developer_code, bet_with_bonus, transaction_id,
       debit_transaction_id, credit_transaction_id, round, session,
       created_at, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
     ON CONFLICT (id) DO UPDATE SET
       user_id               = EXCLUDED.user_id,
       category              = EXCLUDED.category,
       amount                = EXCLUDED.amount,
       return_amount         = EXCLUDED.return_amount,
       status                = EXCLUDED.status,
       bet_type              = EXCLUDED.bet_type,
       currency              = EXCLUDED.currency,
       match_id              = EXCLUDED.match_id,
       market_id             = EXCLUDED.market_id,
       market_name           = EXCLUDED.market_name,
       result_string         = EXCLUDED.result_string,
       team_name             = EXCLUDED.team_name,
       bet_title             = EXCLUDED.bet_title,
       bet_name              = EXCLUDED.bet_name,
       tournament_name       = EXCLUDED.tournament_name,
       outcome_id            = EXCLUDED.outcome_id,
       sports_type           = EXCLUDED.sports_type,
       device_type           = EXCLUDED.device_type,
       user_ip               = EXCLUDED.user_ip,
       bet_status            = EXCLUDED.bet_status,
       wallet_id             = EXCLUDED.wallet_id,
       game_code             = EXCLUDED.game_code,
       developer_code        = EXCLUDED.developer_code,
       bet_with_bonus        = EXCLUDED.bet_with_bonus,
       transaction_id        = EXCLUDED.transaction_id,
       debit_transaction_id  = EXCLUDED.debit_transaction_id,
       credit_transaction_id = EXCLUDED.credit_transaction_id,
       round                 = EXCLUDED.round,
       session               = EXCLUDED.session,
       updated_at            = EXCLUDED.updated_at`,
    [
      row.id, row.user_id, row.category, row.amount, row.return_amount, row.status, row.bet_type, row.currency,
      row.match_id, row.market_id, row.market_name, row.result_string, row.team_name, row.bet_title,
      row.bet_name, row.tournament_name, row.outcome_id, row.sports_type, row.device_type, row.user_ip,
      row.bet_status, row.wallet_id,
      row.game_code, row.developer_code, row.bet_with_bonus, row.transaction_id,
      row.debit_transaction_id, row.credit_transaction_id, row.round, row.session,
      row.created_at, row.updated_at,
    ]
  );
}

// Event names are "sportsbook.bet_placed" / "sportsbook.bet_status_updated"
// or "casino.bet_placed" / "casino.session_settled" (docs/tech-crm-webhooks.pdf).
// The prefix before the first "." is the category — this is what "use
// body.event to know which event type it is, rather than inferring it from
// the route path" means for this file specifically: previously category
// was a hardcoded literal passed in based on which route matched.
function categoryFromEvent(eventName: string | undefined): "sportsbook" | "casino" | null {
  const prefix = eventName?.split(".")[0];
  if (prefix === "sportsbook") return "sportsbook";
  if (prefix === "casino") return "casino";
  return null;
}

// OLDER ASSUMED FORMAT (flat, no envelope) — kept for reference in case the
// envelope guess turns out wrong and this needs reverting. Under the old
// assumption, category came from which route matched (hardcoded per call
// site below), the body was read directly off req.body, and raw logging
// happened per-route right here:
//
//   async function handleBetWebhook(category, routePath, req, res) {
//     const body = req.body;
//     await logRawEvent(routePath, body.event ?? null, body.userId ?? null, body);
//     if (body.user) await upsertPlayerCore(body.user);
//     if (Array.isArray(body.wallet)) await upsertWallets(body.wallet);
//     await upsertBet({ id: body._id, user_id: body.userId, category, ... });
//     ...
//   }
//   betsRouter.post("/sportsbook", express.json(), (req, res) => handleBetWebhook("sportsbook", "/sportsbook", req, res));
//   betsRouter.post("/casino", express.json(), (req, res) => handleBetWebhook("casino", "/casino", req, res));
//
// Confirmed with Satyam: the real shape is an envelope — {event, eventId,
// timestamp, data} — category is now derived from `event`, and `data`
// holds what used to be the body root. Raw logging now happens once,
// globally, in envelope.ts — not per-route.
async function handleBetWebhook(routePath: string, req: Request, res: Response) {
  const envelope = req.webhookEnvelope;
  const data = envelope?.data;
  const category = categoryFromEvent(envelope?.event);

  if (!data || !category) {
    return res.status(400).json({ ok: false });
  }

  try {
    if (data.user) await upsertPlayerCore(data.user);
    if (Array.isArray(data.wallet)) await upsertWallets(data.wallet);

    await upsertBet({
      id: data._id,
      user_id: data.userId,
      category,
      amount: data.amount ?? null,
      return_amount: data.return_amount ?? null,
      status: data.status ?? null,
      bet_type: data.bet_type ?? null,
      currency: data.currency ?? null,
      match_id: data.match_id ?? null,
      market_id: data.market_id ?? null,
      market_name: data.market_name ?? null,
      result_string: data.result_string ?? null,
      team_name: data.team_name ?? null,
      bet_title: data.bet_title ?? null,
      bet_name: data.bet_name ?? null,
      tournament_name: data.tournament_name ?? null,
      outcome_id: data.outcome_id ?? null,
      sports_type: data.sports_type ?? null,
      device_type: data.device_type ?? null,
      user_ip: data.user_ip ?? null,
      bet_status: data.bet_status ?? null,
      wallet_id: data.wallet_id ?? null,
      game_code: data.game_code ?? null,
      developer_code: data.developer_code ?? null,
      bet_with_bonus: data.bet_with_bonus ?? null,
      transaction_id: data.transaction_id ?? null,
      debit_transaction_id: data.debit_transaction_id ?? null,
      credit_transaction_id: data.credit_transaction_id ?? null,
      round: data.round ?? null,
      session: data.session ?? null,
      created_at: data.createdAt ?? null,
      updated_at: data.updatedAt ?? null,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`${routePath} webhook failed:`, err);
    res.status(500).json({ ok: false });
  }
}

betsRouter.post("/sportsbook", (req, res) => handleBetWebhook("/sportsbook", req, res));
betsRouter.post("/casino", (req, res) => handleBetWebhook("/casino", req, res));
