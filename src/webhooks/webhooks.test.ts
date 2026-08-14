import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { webhooksRouter } from "./index.js";
import { pool } from "../db.js";

// Real end-to-end tests: real HTTP requests against the actual
// webhooksRouter, real Postgres (the same dev DB every other webhook test
// in this project uses — there's no mocked-DB convention here). Spins up
// a fresh Express app on an ephemeral port rather than touching the real
// server.ts, so this never collides with a `npm run dev` instance already
// running on :4000.

const SECRET = process.env.WEBHOOK_SIGNING_SECRET;
if (!SECRET) {
  throw new Error("WEBHOOK_SIGNING_SECRET must be set in .env to run these tests");
}

let baseUrl: string;
let server: http.Server;

before(async () => {
  const app = express();
  app.use(webhooksRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

function sign(body: string): string {
  return crypto.createHmac("sha256", SECRET!).update(body).digest("hex");
}

async function post(path: string, bodyString: string, signature: string | undefined) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== undefined) headers["X-Webhook-Signature"] = signature;
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: bodyString });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function cleanupEventId(eventId: string) {
  await pool.query("DELETE FROM raw_webhook_events WHERE event_id = $1", [eventId]);
}

async function cleanupPlayer(userId: string) {
  await pool.query("DELETE FROM players WHERE id = $1", [userId]);
}

test("valid signature + envelope: passes and stores correctly", async () => {
  const eventId = "test_evt_valid_1";
  const userId = "TEST_PLAYER_VALID_1";
  const envelope = {
    event: "user.registered",
    eventId,
    timestamp: "2026-08-14T00:00:00.000Z",
    data: {
      _id: userId,
      createdAt: "2026-01-01T00:00:00.000Z",
      is_blocked: false,
      username: "webhook_test_user",
    },
  };
  const bodyString = JSON.stringify(envelope);

  const { status, body } = await post("/users", bodyString, sign(bodyString));
  assert.equal(status, 200);
  assert.equal(body?.ok, true);

  const raw = await pool.query("SELECT event_id, event_name, user_id FROM raw_webhook_events WHERE event_id = $1", [eventId]);
  assert.equal(raw.rowCount, 1);
  assert.equal(raw.rows[0].event_name, "user.registered");
  assert.equal(raw.rows[0].user_id, userId);

  const player = await pool.query("SELECT id, username FROM players WHERE id = $1", [userId]);
  assert.equal(player.rowCount, 1);
  assert.equal(player.rows[0].username, "webhook_test_user");

  await cleanupEventId(eventId);
  await cleanupPlayer(userId);
});

test("invalid signature: rejected, but the raw event is still persisted", async () => {
  const eventId = "test_evt_invalid_sig_1";
  const userId = "TEST_PLAYER_INVALID_SIG_1";
  const envelope = {
    event: "user.registered",
    eventId,
    timestamp: "2026-08-14T00:00:00.000Z",
    data: { _id: userId, createdAt: "2026-01-01T00:00:00.000Z", is_blocked: false, username: "should_not_land" },
  };
  const bodyString = JSON.stringify(envelope);

  const { status, body } = await post("/users", bodyString, "0".repeat(64));
  assert.equal(status, 401);
  assert.equal(body?.error, "unauthorized");

  // Persisted despite the bad signature...
  const raw = await pool.query("SELECT event_id FROM raw_webhook_events WHERE event_id = $1", [eventId]);
  assert.equal(raw.rowCount, 1);

  // ...but never processed into the domain table.
  const player = await pool.query("SELECT id FROM players WHERE id = $1", [userId]);
  assert.equal(player.rowCount, 0);

  await cleanupEventId(eventId);
});

test("missing signature header: rejected the same way as a wrong one", async () => {
  const eventId = "test_evt_missing_sig_1";
  const envelope = {
    event: "user.registered",
    eventId,
    timestamp: "2026-08-14T00:00:00.000Z",
    data: { _id: "TEST_PLAYER_MISSING_SIG_1", createdAt: "2026-01-01T00:00:00.000Z", is_blocked: false },
  };
  const bodyString = JSON.stringify(envelope);

  const { status } = await post("/users", bodyString, undefined);
  assert.equal(status, 401);

  await cleanupEventId(eventId);
});

test("retry with the same eventId: deduplicated, no second raw log row", async () => {
  const eventId = "test_evt_dedup_1";
  const userId = "TEST_PLAYER_DEDUP_1";
  const envelope = {
    event: "user.registered",
    eventId,
    timestamp: "2026-08-14T00:00:00.000Z",
    data: { _id: userId, createdAt: "2026-01-01T00:00:00.000Z", is_blocked: false, username: "dedup_test" },
  };
  const bodyString = JSON.stringify(envelope);
  const signature = sign(bodyString);

  const first = await post("/users", bodyString, signature);
  assert.equal(first.status, 200);

  // Same delivery, resent verbatim — as the doc says retries can do.
  const second = await post("/users", bodyString, signature);
  assert.equal(second.status, 200);

  const raw = await pool.query("SELECT count(*)::int AS count FROM raw_webhook_events WHERE event_id = $1", [eventId]);
  assert.equal(raw.rows[0].count, 1);

  await cleanupEventId(eventId);
  await cleanupPlayer(userId);
});
