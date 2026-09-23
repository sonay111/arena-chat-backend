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
--
-- event_id (added 2026-08, once Satyam confirmed the real envelope format
-- {event, eventId, timestamp, data}): the doc says retries can resend the
-- same delivery, so this is unique (when present) and used to dedupe —
-- a retried delivery updates nothing and inserts no second row. Nullable:
-- older/malformed payloads that never carried an eventId still get logged.
CREATE TABLE IF NOT EXISTS raw_webhook_events (
  id          BIGSERIAL PRIMARY KEY,
  route       TEXT NOT NULL,        -- e.g. /deposits, /withdrawals/status-update, /bonuses
  event_name  TEXT,                 -- the envelope's event field
  event_id    TEXT,                 -- the envelope's eventId field — see note above
  user_id     TEXT,
  payload     JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_raw_webhook_events_user ON raw_webhook_events (user_id);

-- ALTER, not just CREATE IF NOT EXISTS — raw_webhook_events already existed
-- before event_id was added (same reasoning as the payments table below).
-- Must run before the index below, which references this column — on an
-- already-existing table, CREATE TABLE IF NOT EXISTS is a no-op, so this
-- ALTER is the only thing that actually adds the column there.
ALTER TABLE raw_webhook_events ADD COLUMN IF NOT EXISTS event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_webhook_events_event_id ON raw_webhook_events (event_id) WHERE event_id IS NOT NULL;

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

-- Real per-player country, confirmed 2026-09 via raw_webhook_events
-- investigation: only the /users registration payload carries this (an
-- ISO 3166-1 alpha-2 code, e.g. "IN", "AM") — no other webhook event type
-- has it, and it's NOT the same thing as the pre-existing country_code
-- column above (that's a phone dialing code like "91", fed by the
-- smaller "shared user object" on payments/bets/bonuses webhooks — see
-- upsertPlayerCore). Deliberately a separate column so the two distinct
-- real data points never get conflated.
ALTER TABLE players ADD COLUMN IF NOT EXISTS country TEXT;

-- Dedupe gate for the withdrawal-delay detector (src/alerts/): once a
-- withdrawal has been flagged as delayed, it's never re-flagged, even
-- after it eventually completes. NOT NULL DEFAULT false so every existing
-- row backfills to "not flagged" rather than NULL.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS flagged_delayed BOOLEAN NOT NULL DEFAULT false;

-- Ordering guard for the payments upsert (src/webhooks/payments.ts): the
-- envelope's own timestamp field (when the platform sent this event),
-- NOT received_at (when we happened to receive/process it) -- confirmed
-- live 2026-09-23 that two close-together webhook writes (withdrawal
-- 6ab3a2c50ec99d159c970c0a's .completed then .rejected, 8 seconds apart)
-- landed out of order in the database: the older .completed write's
-- INSERT/UPDATE physically committed after the newer .rejected write's,
-- silently overwriting the correct, newer status with a stale one. Every
-- upsert now only applies if the incoming event's timestamp is strictly
-- newer than whatever's already stored here.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ;

-- Confirmed real 2026-09-23: Satyam's withdrawal webhooks now carry a
-- reason field (admin-typed reason on rejection, provider error message
-- on gateway failure, null otherwise) on initiated/completed/rejected/
-- failed/cancelled. Populated from data.reason in the same upsert as
-- status, guarded by the same event_timestamp check above -- a stale
-- event must never overwrite a newer reason, same principle as status.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reason TEXT;

-- Partial index: only covers withdrawals the detector still needs to look
-- at (unflagged). Shrinks as withdrawals get flagged instead of growing
-- with the whole payments table.
CREATE INDEX IF NOT EXISTS idx_payments_withdrawal_delay_pending ON payments (created_at)
  WHERE payment_type = 'withdrawal' AND flagged_delayed = false;

-- One row per flagged withdrawal, written once at flag time. player_context
-- is a snapshot from the CRM API captured at that moment (not re-fetched on
-- every GET /alerts/withdrawal-delays) — withdrawal fields themselves
-- (amount/status/etc.) are read live from payments via a join, since those
-- can still change after flagging.
CREATE TABLE IF NOT EXISTS withdrawal_delay_alerts (
  id             BIGSERIAL PRIMARY KEY,
  payment_id     TEXT NOT NULL UNIQUE REFERENCES payments(id),
  player_context JSONB NOT NULL,
  flagged_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Refresh-detection alerts (src/alerts/refresh-detection.ts) =====
-- Separate feature from withdrawal-delay alerts above — a different
-- caller reports "this player refreshed repeatedly" and we just log +
-- store it for now. The exact contract (what refresh_count counts, who
-- generates the timestamp, its format) isn't confirmed with Satyam yet,
-- so client_timestamp stays TEXT (verbatim, not parsed as a real
-- timestamp) and the full raw body is kept in payload — same reasoning as
-- raw_webhook_events above: don't lose data to a schema guessed too early.
CREATE TABLE IF NOT EXISTS refresh_alerts (
  id               BIGSERIAL PRIMARY KEY,
  player_id        TEXT NOT NULL,
  refresh_count    NUMERIC,
  client_timestamp TEXT,
  payload          JSONB NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_alerts_player ON refresh_alerts (player_id);

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

-- ===== Odds feed status-transition log (src/odds-feed/) =====
-- Deliberately NOT a full raw-message log like raw_webhook_events -- at
-- roughly 185k odds messages/day, logging every one would be far too much
-- volume for what this needs to answer. Only the transition itself
-- (old status -> new status) is recorded, whenever a match's event_status
-- actually changes (src/odds-feed/state.ts's applyMatchMessage detects
-- this) -- never the full odds/markets payload, and never a row for a
-- match's very first status (nothing to transition from yet).
CREATE TABLE IF NOT EXISTS odds_status_transitions (
  id          BIGSERIAL PRIMARY KEY,
  match_id    TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_odds_status_transitions_match ON odds_status_transitions (match_id);
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
