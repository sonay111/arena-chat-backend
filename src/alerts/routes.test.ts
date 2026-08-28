import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { pool } from "../db.js";
import { alertsRouter } from "./routes.js";
import { checkWithdrawalDelays } from "./withdrawal-delay-detector.js";
import type { PlayerContext } from "../crm/index.js";

// Real HTTP request against the actual alertsRouter + real Postgres, same
// convention as src/webhooks/webhooks.test.ts. Uses checkWithdrawalDelays
// (with a stubbed CRM fetcher) to produce the alert this test then reads
// back through the endpoint, rather than hand-inserting into
// withdrawal_delay_alerts directly — that keeps the test honest about the
// real flow: detector flags + enriches, endpoint just reads it back.

let baseUrl: string;
let server: http.Server;

const id = "test_route_wd_over_10";
const userId = "TEST_ROUTE_USER";
const refreshPlayerId = "TEST_ROUTE_REFRESH_PLAYER";

before(async () => {
  const app = express();
  app.use(alertsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  await pool.query(
    `INSERT INTO payments (id, user_id, payment_type, status, amount, currency, created_at, updated_at)
     VALUES ($1, $2, 'withdrawal', 'progress', 250, 'INR', now() - interval '15 minutes', now())`,
    [id, userId]
  );
  const fetcher = async (uid: string): Promise<PlayerContext> => ({
    identity: { _id: uid, username: "route_test_user", createdAt: "2026-01-01T00:00:00.000Z", is_blocked: false },
    recentDeposits: [],
    recentWithdrawals: [],
    activeBonuses: [],
  });
  await checkWithdrawalDelays(fetcher);

  await pool.query(
    `INSERT INTO refresh_alerts (player_id, refresh_count, client_timestamp, payload)
     VALUES ($1, 3, '2026-08-25T09:00:00.000Z', $2)`,
    [refreshPlayerId, JSON.stringify({ playerId: refreshPlayerId, refreshCount: 3, timestamp: "2026-08-25T09:00:00.000Z" })]
  );
});

after(async () => {
  await pool.query("DELETE FROM withdrawal_delay_alerts WHERE payment_id = $1", [id]);
  await pool.query("DELETE FROM payments WHERE id = $1", [id]);
  await pool.query("DELETE FROM refresh_alerts WHERE player_id = $1", [refreshPlayerId]);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("GET /alerts/withdrawal-delays returns combined withdrawal + player data", async () => {
  const res = await fetch(`${baseUrl}/alerts/withdrawal-delays`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const alert = body.alerts.find((a: any) => a.paymentId === id);
  assert.ok(alert, "expected the flagged withdrawal to appear in the response");
  assert.equal(alert.userId, userId);
  assert.equal(alert.amount, "250");
  assert.equal(alert.status, "progress");
  assert.equal(alert.player.identity._id, userId);
  assert.equal(alert.player.identity.username, "route_test_user");
});

test("GET /alerts/refresh-detections returns player id, refresh count, and timestamp, most recent first", async () => {
  const res = await fetch(`${baseUrl}/alerts/refresh-detections`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const detection = body.detections.find((d: any) => d.playerId === refreshPlayerId);
  assert.ok(detection, "expected the seeded refresh detection to appear in the response");
  assert.equal(detection.refreshCount, "3");
  assert.equal(detection.timestamp, "2026-08-25T09:00:00.000Z");

  // Most recent first: this row's receivedAt shouldn't be older than any
  // other row ahead of it in the list.
  const receivedTimes = body.detections.map((d: any) => new Date(d.receivedAt).getTime());
  const sorted = [...receivedTimes].sort((a, b) => b - a);
  assert.deepEqual(receivedTimes, sorted);
});
