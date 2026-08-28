import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { pool } from "../db.js";
import { refreshAlertsRouter } from "./refresh-detection.js";

// Real end-to-end tests, same convention as src/webhooks/webhooks.test.ts:
// real HTTP requests against the actual refreshAlertsRouter, real Postgres,
// real HMAC signing — confirmed 2026-08-25 this is a genuine signed
// webhook from Satyam's team (v3.arena365.com), envelope-wrapped exactly
// like every other CRM webhook, not the flat unsigned placeholder body the
// original version of this route assumed.

const SECRET = process.env.WEBHOOK_SIGNING_SECRET;
if (!SECRET) {
  throw new Error("WEBHOOK_SIGNING_SECRET must be set in .env to run these tests");
}

let baseUrl: string;
let server: http.Server;

before(async () => {
  const app = express();
  app.use(refreshAlertsRouter);
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

async function post(bodyString: string, signature: string | undefined) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== undefined) headers["X-Webhook-Signature"] = signature;
  const res = await fetch(`${baseUrl}/alerts/refresh-detected`, { method: "POST", headers, body: bodyString });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function cleanupEventId(eventId: string) {
  await pool.query("DELETE FROM raw_webhook_events WHERE event_id = $1", [eventId]);
}

async function cleanupRefreshAlert(playerId: string) {
  await pool.query("DELETE FROM refresh_alerts WHERE player_id = $1", [playerId]);
}

function makeEnvelope(eventId: string, playerId: string, refreshCount: number, timestamp: string) {
  return {
    event: "player.refresh_detected",
    eventId,
    timestamp: "2026-08-25T08:28:55.796Z",
    data: { playerId, refreshCount, timestamp },
  };
}

test("a validly-signed refresh event is accepted and stored", async () => {
  const eventId = "test_evt_refresh_valid_1";
  const playerId = "TEST_REFRESH_PLAYER_VALID_1";
  const envelope = makeEnvelope(eventId, playerId, 2, "2026-08-25T08:28:55.784Z");
  const bodyString = JSON.stringify(envelope);

  const { status, body } = await post(bodyString, sign(bodyString));
  assert.equal(status, 200);
  assert.equal(body?.ok, true);

  const raw = await pool.query(
    "SELECT event_name, user_id FROM raw_webhook_events WHERE event_id = $1",
    [eventId]
  );
  assert.equal(raw.rowCount, 1);
  assert.equal(raw.rows[0].event_name, "player.refresh_detected");
  assert.equal(raw.rows[0].user_id, playerId);

  const alert = await pool.query(
    "SELECT player_id, refresh_count, client_timestamp, payload FROM refresh_alerts WHERE player_id = $1",
    [playerId]
  );
  assert.equal(alert.rowCount, 1);
  assert.equal(alert.rows[0].player_id, playerId);
  assert.equal(alert.rows[0].refresh_count, "2");
  assert.equal(alert.rows[0].client_timestamp, "2026-08-25T08:28:55.784Z");
  assert.equal(alert.rows[0].payload.playerId, playerId);

  await cleanupEventId(eventId);
  await cleanupRefreshAlert(playerId);
});

test("invalid signature: rejected, not stored in refresh_alerts (raw event still persisted)", async () => {
  const eventId = "test_evt_refresh_invalid_sig_1";
  const playerId = "TEST_REFRESH_PLAYER_INVALID_SIG_1";
  const envelope = makeEnvelope(eventId, playerId, 3, "2026-08-25T08:28:55.784Z");
  const bodyString = JSON.stringify(envelope);

  const { status, body } = await post(bodyString, "0".repeat(64));
  assert.equal(status, 401);
  assert.equal(body?.error, "unauthorized");

  const raw = await pool.query("SELECT event_id FROM raw_webhook_events WHERE event_id = $1", [eventId]);
  assert.equal(raw.rowCount, 1);

  const alert = await pool.query("SELECT 1 FROM refresh_alerts WHERE player_id = $1", [playerId]);
  assert.equal(alert.rowCount, 0);

  await cleanupEventId(eventId);
});

test("missing signature header: rejected the same way as a wrong one", async () => {
  const eventId = "test_evt_refresh_missing_sig_1";
  const playerId = "TEST_REFRESH_PLAYER_MISSING_SIG_1";
  const envelope = makeEnvelope(eventId, playerId, 1, "2026-08-25T08:28:55.784Z");
  const bodyString = JSON.stringify(envelope);

  const { status } = await post(bodyString, undefined);
  assert.equal(status, 401);

  const alert = await pool.query("SELECT 1 FROM refresh_alerts WHERE player_id = $1", [playerId]);
  assert.equal(alert.rowCount, 0);

  await cleanupEventId(eventId);
});
