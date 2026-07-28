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
`;

async function main() {
  await pool.query(SQL);
  console.log("conversations and messages tables are ready.");
  await pool.end();
}

main().catch((err) => {
  console.error("db-setup failed:", err);
  process.exit(1);
});
