import express, { Router } from "express";
import { pool } from "../db.js";
import { logRawEvent } from "./raw-log.js";
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

async function handleBetWebhook(category: "sportsbook" | "casino", routePath: string, req: express.Request, res: express.Response) {
  const body = req.body;
  try {
    await logRawEvent(routePath, body.event ?? null, body.userId ?? null, body);

    if (body.user) await upsertPlayerCore(body.user);
    if (Array.isArray(body.wallet)) await upsertWallets(body.wallet);

    await upsertBet({
      id: body._id,
      user_id: body.userId,
      category,
      amount: body.amount ?? null,
      return_amount: body.return_amount ?? null,
      status: body.status ?? null,
      bet_type: body.bet_type ?? null,
      currency: body.currency ?? null,
      match_id: body.match_id ?? null,
      market_id: body.market_id ?? null,
      market_name: body.market_name ?? null,
      result_string: body.result_string ?? null,
      team_name: body.team_name ?? null,
      bet_title: body.bet_title ?? null,
      bet_name: body.bet_name ?? null,
      tournament_name: body.tournament_name ?? null,
      outcome_id: body.outcome_id ?? null,
      sports_type: body.sports_type ?? null,
      device_type: body.device_type ?? null,
      user_ip: body.user_ip ?? null,
      bet_status: body.bet_status ?? null,
      wallet_id: body.wallet_id ?? null,
      game_code: body.game_code ?? null,
      developer_code: body.developer_code ?? null,
      bet_with_bonus: body.bet_with_bonus ?? null,
      transaction_id: body.transaction_id ?? null,
      debit_transaction_id: body.debit_transaction_id ?? null,
      credit_transaction_id: body.credit_transaction_id ?? null,
      round: body.round ?? null,
      session: body.session ?? null,
      created_at: body.createdAt ?? null,
      updated_at: body.updatedAt ?? null,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`${routePath} webhook failed:`, err);
    res.status(500).json({ ok: false });
  }
}

betsRouter.post("/sportsbook", express.json(), (req, res) => handleBetWebhook("sportsbook", "/sportsbook", req, res));
betsRouter.post("/casino", express.json(), (req, res) => handleBetWebhook("casino", "/casino", req, res));
