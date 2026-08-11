import { pool } from "./db.js";

const SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id                BIGSERIAL PRIMARY KEY,
  player_id         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'waiting',  -- waiting | open | closed
  assigned_agent_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id),
  sender_type     TEXT NOT NULL,   -- customer | agent | ai
  sender_id       TEXT,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id);

-- ===== Player-data tables (source: docs/tech-crm-webhooks.pdf) =====
-- These are fire-and-forget webhooks with no retries, so raw_webhook_events
-- logs every payload verbatim before any structured parsing happens.

CREATE TABLE IF NOT EXISTS raw_webhook_events (
  id          BIGSERIAL PRIMARY KEY,
  route       TEXT NOT NULL,        -- e.g. /deposits, /withdrawals/status-update, /bonuses
  event_name  TEXT,                 -- null for /users (no event field) and /bonuses (trigger known by source flow, not body)
  user_id     TEXT,
  payload     JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_raw_webhook_events_user ON raw_webhook_events (user_id);

CREATE TABLE IF NOT EXISTS players (
  id               TEXT PRIMARY KEY,   -- platform's _id
  username         TEXT,
  first_name       TEXT,
  email            TEXT,
  phone            TEXT,
  country_code     TEXT,
  is_blocked       BOOLEAN,
  trusted          BOOLEAN,
  withdrawal_block BOOLEAN,
  tracker          TEXT,
  campaign_tag     TEXT,
  affid            TEXT,
  provider         TEXT,
  parent_provider  TEXT,
  click_id         TEXT,
  utm_source       TEXT,
  utm_medium       TEXT,
  utm_campaign     TEXT,
  utm_content      TEXT,
  pixel_id         TEXT,
  registered_at    TIMESTAMPTZ,        -- platform's createdAt from the /users payload
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE ON SPELLING: the platform's own payloads misspell "wagering" three
-- different ways depending on the field, and NOT consistently with each
-- other. This is intentional/verbatim, not a typo on our side — it has to
-- match exactly or incoming data won't map to these columns.
--   required_wegaring_amount, total_wegaring_amount,
--   current_picked_payment_for_wegaring   -> spelled "wegaring"
--   wegering_percent                      -> spelled "wegering" (different vowel)
--   is_wegered (see payments table below) -> spelled "wegered"
CREATE TABLE IF NOT EXISTS player_wallets (
  id                                   TEXT PRIMARY KEY,  -- wallet _id
  user_id                              TEXT NOT NULL,
  currency                             TEXT,              -- INR | USDT
  balance                              NUMERIC,
  wallet_type                          TEXT,              -- fiat | crypto
  status                               TEXT,
  is_default                           BOOLEAN,
  required_wegaring_amount             NUMERIC,
  total_wegaring_amount                NUMERIC,
  current_picked_payment_for_wegaring  TEXT,
  wegering_percent                     NUMERIC,
  withdrawal_able_amount               NUMERIC,
  freebetcash                          NUMERIC,
  created_at                          TIMESTAMPTZ,        -- platform's createdAt
  updated_at                          TIMESTAMPTZ,        -- platform's updatedAt
  received_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_player_wallets_user ON player_wallets (user_id);

-- payment_status/approval_status/screenshot/is_reapproved come from the
-- REAL .initiated payloads Satyam sent (2026-08), which turned out to
-- differ from docs/tech-crm-webhooks.pdf's one documented example (that
-- doc only showed the .status_updated shape). Unlike the doc's asymmetric
-- deposit/withdrawal fields (is_chargedback/gateway/network_fee deposit-only,
-- bank_id/remark withdrawal-only), these four appear in BOTH real .initiated
-- examples we have — so they're not marked withdrawal-only here. bank_id
-- remains withdrawal-only per the original doc example (also confirmed
-- present in the real withdrawal payload, absent from the real deposit one).
CREATE TABLE IF NOT EXISTS payments (
  id                TEXT PRIMARY KEY,     -- payment doc _id
  user_id           TEXT NOT NULL,
  payment_type      TEXT NOT NULL,        -- deposit | withdrawal
  type              TEXT,                 -- e.g. online
  payment_method    TEXT,
  reference_no      TEXT,
  amount            NUMERIC,
  currency          TEXT,
  status            TEXT,
  payment_status    TEXT,                 -- seen: "pending" (real .initiated payloads); relationship to status for a truly completed payment is unconfirmed, see src/guardrails
  approval_status   TEXT,                 -- seen: "not_approved"
  screenshot        TEXT,                 -- seen: null in both real examples; presumably a proof-of-payment reference/URL
  is_reapproved     BOOLEAN,              -- seen: false in both real examples
  payment_id        TEXT,
  ip                TEXT,                 -- deposit only
  is_chargedback    BOOLEAN,              -- deposit only
  is_wegered        BOOLEAN,              -- deposit only (platform's spelling, see note above)
  gateway           TEXT,                 -- deposit only
  network_fee       NUMERIC,              -- deposit only
  payment_data      JSONB,                -- deposit only, e.g. {country, method}
  bank_id           TEXT,                 -- withdrawal only
  remark            TEXT,                 -- withdrawal only
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id);

-- ALTER, not just CREATE IF NOT EXISTS: the payments table already existed
-- in every environment that ran db:setup before this change, and CREATE
-- TABLE IF NOT EXISTS is a no-op against an existing table — it would
-- never add these columns there. ADD COLUMN IF NOT EXISTS keeps this
-- script re-runnable on both fresh and already-created databases.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS approval_status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS screenshot TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_reapproved BOOLEAN;

CREATE TABLE IF NOT EXISTS bets (
  id                    TEXT PRIMARY KEY,   -- bet/casino-bet doc _id
  user_id               TEXT NOT NULL,
  category              TEXT NOT NULL,      -- sportsbook | casino
  amount                NUMERIC,
  return_amount         NUMERIC,
  status                TEXT,
  bet_type              TEXT,
  currency              TEXT,
  -- sportsbook-only fields
  match_id              TEXT,
  market_id             TEXT,
  market_name           TEXT,
  result_string         TEXT,
  team_name             TEXT,
  bet_title             TEXT,
  bet_name              TEXT,
  tournament_name       TEXT,
  outcome_id            TEXT,
  sports_type           TEXT,
  device_type           TEXT,
  user_ip               TEXT,
  bet_status            TEXT,
  wallet_id             TEXT,
  -- casino-only fields
  game_code             TEXT,
  developer_code        TEXT,
  bet_with_bonus        BOOLEAN,
  transaction_id        TEXT,
  debit_transaction_id  TEXT,
  credit_transaction_id TEXT,
  round                 TEXT,
  session               TEXT,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets (user_id);

-- Bonus payload shape varies a lot by type (free bet, deposit %, free spin,
-- cashback) and the doc's four examples don't even agree on the user id key
-- (userId vs user_id) or whether "status" is present (cashback has none).
-- So only the fields common to the envelope are columns; bonus_type and
-- trigger_type aren't in the payload itself (they're known from which
-- endpoint/flow triggered the webhook) and get populated once the route
-- handlers exist in a later step. Everything type-specific stays in payload.
CREATE TABLE IF NOT EXISTS bonuses (
  id           TEXT PRIMARY KEY,   -- bonus doc _id
  user_id      TEXT NOT NULL,      -- normalizes payload's userId / user_id
  bonus_type   TEXT,               -- free_bet | deposit_bonus | free_spin | free_spin_provider | cashback
  trigger_type TEXT,               -- bonus.activated | bonus.expired
  status       TEXT,               -- absent for cashback
  currency     TEXT,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  payload      JSONB NOT NULL,     -- full body: type-specific fields (rewardAmountPerDay, bonus_amount, target_wagering, spin_id, cashback amount, etc.)
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bonuses_user ON bonuses (user_id);
`;

async function main() {
  await pool.query(SQL);
  console.log("conversations, messages, and player-data tables are ready.");
  await pool.end();
}

main().catch((err) => {
  console.error("db-setup failed:", err);
  process.exit(1);
});
