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

// Country-filter fixtures. "ZZ" is ISO's reserved user-assigned code,
// chosen so it can never collide with a real country value. The
// "unknown" side uses no players row at all (not a null-country row) —
// the null-vs-no-row distinction is already exhaustively covered in
// src/activity/routes.test.ts; these tests just need to confirm the same
// shared logic is correctly wired into these two endpoints.
const countryKnownWdPaymentId = "test_route_wd_country_known";
const countryKnownWdUserId = "TEST_ROUTE_USER_COUNTRY_KNOWN";
const countryUnknownWdPaymentId = "test_route_wd_country_unknown";
const countryUnknownWdUserId = "TEST_ROUTE_USER_COUNTRY_UNKNOWN";
const countryKnownRefreshPlayerId = "TEST_ROUTE_REFRESH_PLAYER_COUNTRY_KNOWN";
const countryUnknownRefreshPlayerId = "TEST_ROUTE_REFRESH_PLAYER_COUNTRY_UNKNOWN";

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
  // Same shared-dev-DB caveat as withdrawal-delay-detector.test.ts: this
  // fetcher must only ever answer for the one userId this test created,
  // not any other eligible row the candidate query happens to also find.
  const fetcher = async (uid: string): Promise<PlayerContext> => {
    if (uid !== userId) {
      throw new Error(`unexpected userId "${uid}" passed to test fetcher — refusing to enrich a row this test didn't create`);
    }
    return {
      identity: { _id: uid, username: "route_test_user", createdAt: "2026-01-01T00:00:00.000Z", is_blocked: false },
      recentDeposits: [],
      recentWithdrawals: [],
      activeBonuses: [],
    };
  };
  await checkWithdrawalDelays(fetcher);

  await pool.query(
    `INSERT INTO refresh_alerts (player_id, refresh_count, client_timestamp, payload)
     VALUES ($1, 3, '2026-08-25T09:00:00.000Z', $2)`,
    [refreshPlayerId, JSON.stringify({ playerId: refreshPlayerId, refreshCount: 3, timestamp: "2026-08-25T09:00:00.000Z" })]
  );

  // Country-filter fixtures. Inserted directly (bypassing checkWithdrawalDelays'
  // fetcher / the refresh webhook route) since the country filter only cares
  // that a row exists in these tables joined to players — not how it got there.
  await pool.query(
    `INSERT INTO payments (id, user_id, payment_type, status, amount, currency, created_at, updated_at)
     VALUES ($1, $2, 'withdrawal', 'progress', 100, 'INR', now() - interval '15 minutes', now())`,
    [countryKnownWdPaymentId, countryKnownWdUserId]
  );
  await pool.query(
    `INSERT INTO withdrawal_delay_alerts (payment_id, player_context) VALUES ($1, $2)`,
    [countryKnownWdPaymentId, JSON.stringify({ identity: { _id: countryKnownWdUserId, username: "country_known_user" } })]
  );
  await pool.query(
    `INSERT INTO payments (id, user_id, payment_type, status, amount, currency, created_at, updated_at)
     VALUES ($1, $2, 'withdrawal', 'progress', 100, 'INR', now() - interval '15 minutes', now())`,
    [countryUnknownWdPaymentId, countryUnknownWdUserId]
  );
  await pool.query(
    `INSERT INTO withdrawal_delay_alerts (payment_id, player_context) VALUES ($1, $2)`,
    [countryUnknownWdPaymentId, JSON.stringify({ identity: { _id: countryUnknownWdUserId, username: "country_unknown_user" } })]
  );
  await pool.query("INSERT INTO players (id, country) VALUES ($1, 'ZZ')", [countryKnownWdUserId]);
  // countryUnknownWdUserId deliberately gets no players row at all.

  await pool.query(
    `INSERT INTO refresh_alerts (player_id, refresh_count, client_timestamp, payload)
     VALUES ($1, 1, '2026-08-25T09:05:00.000Z', $2)`,
    [countryKnownRefreshPlayerId, JSON.stringify({ playerId: countryKnownRefreshPlayerId, refreshCount: 1, timestamp: "2026-08-25T09:05:00.000Z" })]
  );
  await pool.query(
    `INSERT INTO refresh_alerts (player_id, refresh_count, client_timestamp, payload)
     VALUES ($1, 1, '2026-08-25T09:06:00.000Z', $2)`,
    [countryUnknownRefreshPlayerId, JSON.stringify({ playerId: countryUnknownRefreshPlayerId, refreshCount: 1, timestamp: "2026-08-25T09:06:00.000Z" })]
  );
  await pool.query("INSERT INTO players (id, country) VALUES ($1, 'ZZ')", [countryKnownRefreshPlayerId]);
  // countryUnknownRefreshPlayerId deliberately gets no players row at all.
});

after(async () => {
  await pool.query("DELETE FROM withdrawal_delay_alerts WHERE payment_id = $1", [id]);
  await pool.query("DELETE FROM payments WHERE id = $1", [id]);
  await pool.query("DELETE FROM refresh_alerts WHERE player_id = $1", [refreshPlayerId]);
  await pool.query("DELETE FROM withdrawal_delay_alerts WHERE payment_id = ANY($1)", [
    [countryKnownWdPaymentId, countryUnknownWdPaymentId],
  ]);
  await pool.query("DELETE FROM payments WHERE id = ANY($1)", [[countryKnownWdPaymentId, countryUnknownWdPaymentId]]);
  await pool.query("DELETE FROM refresh_alerts WHERE player_id = ANY($1)", [
    [countryKnownRefreshPlayerId, countryUnknownRefreshPlayerId],
  ]);
  await pool.query("DELETE FROM players WHERE id = ANY($1)", [[countryKnownWdUserId, countryKnownRefreshPlayerId]]);
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

test("GET /alerts/withdrawal-delays: country filter — a real country code returns only that player's alert", async () => {
  const res = await fetch(`${baseUrl}/alerts/withdrawal-delays?country=ZZ`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const userIds = body.alerts.map((a: any) => a.userId);

  assert.ok(userIds.includes(countryKnownWdUserId));
  assert.ok(!userIds.includes(countryUnknownWdUserId));
});

test("GET /alerts/withdrawal-delays: country=unknown matches a player with no country on file (case-insensitive)", async () => {
  const res = await fetch(`${baseUrl}/alerts/withdrawal-delays?country=UNKNOWN`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const userIds = body.alerts.map((a: any) => a.userId);

  assert.ok(userIds.includes(countryUnknownWdUserId));
  assert.ok(!userIds.includes(countryKnownWdUserId));
});

test("GET /alerts/withdrawal-delays: no country param — behaves exactly as before this filter existed", async () => {
  const res = await fetch(`${baseUrl}/alerts/withdrawal-delays`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const userIds = body.alerts.map((a: any) => a.userId);

  assert.ok(userIds.includes(countryKnownWdUserId));
  assert.ok(userIds.includes(countryUnknownWdUserId));
  assert.ok(userIds.includes(userId), "the original fixture (no players row either) must still appear");
});

test("GET /alerts/refresh-detections: country filter — a real country code returns only that player's detection", async () => {
  const res = await fetch(`${baseUrl}/alerts/refresh-detections?country=ZZ`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const playerIds = body.detections.map((d: any) => d.playerId);

  assert.ok(playerIds.includes(countryKnownRefreshPlayerId));
  assert.ok(!playerIds.includes(countryUnknownRefreshPlayerId));
});

test("GET /alerts/refresh-detections: country=unknown matches a player with no country on file (case-insensitive)", async () => {
  const res = await fetch(`${baseUrl}/alerts/refresh-detections?country=UNKNOWN`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const playerIds = body.detections.map((d: any) => d.playerId);

  assert.ok(playerIds.includes(countryUnknownRefreshPlayerId));
  assert.ok(!playerIds.includes(countryKnownRefreshPlayerId));
});

test("GET /alerts/refresh-detections: no country param — behaves exactly as before this filter existed", async () => {
  const res = await fetch(`${baseUrl}/alerts/refresh-detections`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const playerIds = body.detections.map((d: any) => d.playerId);

  assert.ok(playerIds.includes(countryKnownRefreshPlayerId));
  assert.ok(playerIds.includes(countryUnknownRefreshPlayerId));
  assert.ok(playerIds.includes(refreshPlayerId), "the original fixture (no players row either) must still appear");
});
