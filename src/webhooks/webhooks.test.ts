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

async function cleanupPayment(paymentId: string) {
  await pool.query("DELETE FROM payments WHERE id = $1", [paymentId]);
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

// Real traffic confirmed 2026-09: only user.registered carries a country
// field (ISO 3166-1 alpha-2, e.g. "IN"), and it's a distinct field from
// the pre-existing country_code column (a phone dialing code from a
// different webhook shape) — this must land in its own column, not get
// conflated with or overwrite country_code.
test("user.registered with a country field: persists to players.country", async () => {
  const eventId = "test_evt_country_1";
  const userId = "TEST_PLAYER_COUNTRY_1";
  const envelope = {
    event: "user.registered",
    eventId,
    timestamp: "2026-08-14T00:00:00.000Z",
    data: {
      _id: userId,
      createdAt: "2026-01-01T00:00:00.000Z",
      is_blocked: false,
      username: "country_test_user",
      country: "IN",
    },
  };
  const bodyString = JSON.stringify(envelope);

  const { status, body } = await post("/users", bodyString, sign(bodyString));
  assert.equal(status, 200);
  assert.equal(body?.ok, true);

  const player = await pool.query("SELECT country, country_code FROM players WHERE id = $1", [userId]);
  assert.equal(player.rowCount, 1);
  assert.equal(player.rows[0].country, "IN");
  assert.equal(player.rows[0].country_code, null, "country must not be conflated with the separate country_code column");

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

// Real traffic confirmed 2026-08-25 (evt_93c4a8b099940cc7, retried since
// 2026-08-20): some /deposits deliveries omit paymentType entirely, a
// simpler shape than the "initiated"/"status_updated" examples this
// handler was originally built against. payment_type is NOT NULL, so this
// exact shape was crashing every insert with a 500 before the route-based
// inference fallback in payments.ts.
test("/deposits with no paymentType field: inferred as 'deposit' from the route, not a 500", async () => {
  const eventId = "test_evt_deposit_no_paymenttype";
  const paymentId = "test_payment_no_paymenttype";
  const envelope = {
    event: "deposit.completed",
    eventId,
    timestamp: "2026-08-25T08:23:00.994Z",
    data: {
      _id: paymentId,
      userId: "TEST_PLAYER_DEPOSIT_NO_TYPE",
      amount: 20,
      dateTime: "2026-08-25T08:23:00.796Z",
      status: "completed",
      currency: "usdttrc20",
    },
  };
  const bodyString = JSON.stringify(envelope);

  const { status, body } = await post("/deposits", bodyString, sign(bodyString));
  assert.equal(status, 200);
  assert.equal(body?.ok, true);

  const payment = await pool.query("SELECT payment_type, user_id, amount FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rowCount, 1);
  assert.equal(payment.rows[0].payment_type, "deposit");

  await cleanupEventId(eventId);
  await cleanupPayment(paymentId);
});

// Guards the other half of the fallback: when paymentType IS present, it
// must win unchanged — the route-based inference is a fallback for when
// the field is missing, not a rule that overrides real data.
test("/withdrawals with paymentType present: the provided value wins, not the route guess", async () => {
  const eventId = "test_evt_withdrawal_with_paymenttype";
  const paymentId = "test_payment_withdrawal_with_type";
  const envelope = {
    event: "withdrawal.status_updated",
    eventId,
    timestamp: "2026-07-04T09:05:00.000Z",
    data: {
      _id: paymentId,
      userId: "TEST_PLAYER_WITHDRAWAL_WITH_TYPE",
      paymentType: "withdrawal",
      amount: 2500,
      currency: "INR",
      status: "completed",
    },
  };
  const bodyString = JSON.stringify(envelope);

  const { status } = await post("/withdrawals/status-update", bodyString, sign(bodyString));
  assert.equal(status, 200);

  const payment = await pool.query("SELECT payment_type FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rowCount, 1);
  assert.equal(payment.rows[0].payment_type, "withdrawal");

  await cleanupEventId(eventId);
  await cleanupPayment(paymentId);
});

// Symmetric case to the /deposits fix: paymentType missing on /withdrawals
// should infer 'withdrawal', not fall back to 'deposit'.
test("/withdrawals with no paymentType field: inferred as 'withdrawal' from the route", async () => {
  const eventId = "test_evt_withdrawal_no_paymenttype";
  const paymentId = "test_payment_withdrawal_no_type";
  const envelope = {
    event: "withdrawal.completed",
    eventId,
    timestamp: "2026-08-25T08:23:00.994Z",
    data: {
      _id: paymentId,
      userId: "TEST_PLAYER_WITHDRAWAL_NO_TYPE",
      amount: 100,
      status: "completed",
      currency: "INR",
    },
  };
  const bodyString = JSON.stringify(envelope);

  const { status } = await post("/withdrawals", bodyString, sign(bodyString));
  assert.equal(status, 200);

  const payment = await pool.query("SELECT payment_type FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rowCount, 1);
  assert.equal(payment.rows[0].payment_type, "withdrawal");

  await cleanupEventId(eventId);
  await cleanupPayment(paymentId);
});

// Real traffic confirmed 2026-08-27 (evt_0ef377ccfe4d8d32): this same
// simpler shape also omits createdAt, using dateTime instead. created_at
// was silently landing NULL, which permanently hides the row from the
// withdrawal-delay detector's `created_at < now() - interval` check —
// worse than the paymentType crash, since this failed silently (200 OK,
// row inserted, just useless for the delay check).
test("/withdrawals with no createdAt field: falls back to dateTime, not left NULL", async () => {
  const eventId = "test_evt_withdrawal_no_createdat";
  const paymentId = "test_payment_withdrawal_no_createdat";
  const envelope = {
    event: "withdrawal.completed",
    eventId,
    timestamp: "2026-08-27T07:48:09.555Z",
    data: {
      _id: paymentId,
      userId: "TEST_PLAYER_WITHDRAWAL_NO_CREATEDAT",
      amount: 9,
      currency: "usdttrc20",
      status: "completed",
      dateTime: "2026-08-27T07:48:09.395Z",
    },
  };
  const bodyString = JSON.stringify(envelope);

  const { status } = await post("/withdrawals", bodyString, sign(bodyString));
  assert.equal(status, 200);

  const payment = await pool.query("SELECT created_at FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rowCount, 1);
  assert.equal(payment.rows[0].created_at.toISOString(), "2026-08-27T07:48:09.395Z");

  await cleanupEventId(eventId);
  await cleanupPayment(paymentId);
});

// Guards the other half of the fallback: when createdAt IS present, it
// must win unchanged, the same way paymentType does above.
test("/withdrawals with createdAt present: the provided value wins over dateTime", async () => {
  const eventId = "test_evt_withdrawal_with_createdat";
  const paymentId = "test_payment_withdrawal_with_createdat";
  const envelope = {
    event: "withdrawal.status_updated",
    eventId,
    timestamp: "2026-07-04T09:05:00.000Z",
    data: {
      _id: paymentId,
      userId: "TEST_PLAYER_WITHDRAWAL_WITH_CREATEDAT",
      paymentType: "withdrawal",
      amount: 2500,
      currency: "INR",
      status: "completed",
      createdAt: "2026-07-04T09:00:00.000Z",
      dateTime: "2026-07-04T09:05:00.000Z",
    },
  };
  const bodyString = JSON.stringify(envelope);

  const { status } = await post("/withdrawals/status-update", bodyString, sign(bodyString));
  assert.equal(status, 200);

  const payment = await pool.query("SELECT created_at FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rowCount, 1);
  assert.equal(payment.rows[0].created_at.toISOString(), "2026-07-04T09:00:00.000Z");

  await cleanupEventId(eventId);
  await cleanupPayment(paymentId);
});

// Ordering guard (added after a real race found live 2026-09-23 on
// withdrawal 6ab3a2c50ec99d159c970c0a): two close-together webhook writes
// landed out of order in the database, the older .completed write
// physically committing after the newer .rejected write and silently
// overwriting it. These tests send the events in reverse chronological
// HTTP-arrival order on purpose -- if the guard only compared "did I
// arrive later," reversing arrival order would flip the outcome; since it
// compares the envelope's own timestamp instead, arrival order must never
// matter, only which event is actually newer.

test("ordering guard: an older event arriving AFTER a newer one must not overwrite it", async () => {
  const paymentId = "test_payment_ordering_guard_1";
  const olderEventId = "test_evt_ordering_guard_1_older";
  const newerEventId = "test_evt_ordering_guard_1_newer";

  const newerEnvelope = {
    event: "withdrawal.completed",
    eventId: newerEventId,
    timestamp: "2026-09-23T09:58:46.565Z", // real newer timestamp from the live race
    data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_1", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "completed" },
  };
  const olderEnvelope = {
    event: "withdrawal.initiated",
    eventId: olderEventId,
    timestamp: "2026-09-23T09:58:29.780Z", // real older timestamp from the live race
    data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_1", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "pending" },
  };

  // Newer event's HTTP request sent and processed FIRST...
  const first = await post("/withdrawals", JSON.stringify(newerEnvelope), sign(JSON.stringify(newerEnvelope)));
  assert.equal(first.status, 200);
  // ...then the older event arrives SECOND, simulating its database write
  // landing after the newer one's.
  const second = await post("/withdrawals", JSON.stringify(olderEnvelope), sign(JSON.stringify(olderEnvelope)));
  assert.equal(second.status, 200, "the older event is still accepted (200), just doesn't win the upsert");

  const payment = await pool.query("SELECT status, event_timestamp FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rowCount, 1);
  assert.equal(payment.rows[0].status, "completed", "the older .initiated/pending event must not overwrite the newer .completed status");
  assert.equal(payment.rows[0].event_timestamp.toISOString(), "2026-09-23T09:58:46.565Z");

  await cleanupEventId(olderEventId);
  await cleanupEventId(newerEventId);
  await cleanupPayment(paymentId);
});

test("ordering guard: a newer event arriving AFTER an older one correctly wins (the normal case still works)", async () => {
  const paymentId = "test_payment_ordering_guard_2";
  const olderEventId = "test_evt_ordering_guard_2_older";
  const newerEventId = "test_evt_ordering_guard_2_newer";

  const olderEnvelope = {
    event: "withdrawal.initiated",
    eventId: olderEventId,
    timestamp: "2026-09-23T09:58:29.780Z",
    data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_2", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "pending" },
  };
  const newerEnvelope = {
    event: "withdrawal.completed",
    eventId: newerEventId,
    timestamp: "2026-09-23T09:58:46.565Z",
    data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_2", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "completed" },
  };

  const first = await post("/withdrawals", JSON.stringify(olderEnvelope), sign(JSON.stringify(olderEnvelope)));
  assert.equal(first.status, 200);
  const second = await post("/withdrawals", JSON.stringify(newerEnvelope), sign(JSON.stringify(newerEnvelope)));
  assert.equal(second.status, 200);

  const payment = await pool.query("SELECT status FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rows[0].status, "completed");

  await cleanupEventId(olderEventId);
  await cleanupEventId(newerEventId);
  await cleanupPayment(paymentId);
});

test("ordering guard: reproduces the exact real race (initiated, completed, rejected) -- final status is 'rejected' regardless of send order", async () => {
  const paymentId = "test_payment_ordering_guard_3";
  const ids = {
    initiated: "test_evt_ordering_guard_3_initiated",
    completed: "test_evt_ordering_guard_3_completed",
    rejected: "test_evt_ordering_guard_3_rejected",
  };
  const envelopes = {
    initiated: {
      event: "withdrawal.initiated",
      eventId: ids.initiated,
      timestamp: "2026-09-23T09:58:29.780Z",
      data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_3", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "pending" },
    },
    completed: {
      event: "withdrawal.completed",
      eventId: ids.completed,
      timestamp: "2026-09-23T09:58:46.565Z",
      data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_3", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "completed" },
    },
    rejected: {
      event: "withdrawal.rejected",
      eventId: ids.rejected,
      timestamp: "2026-09-23T09:58:54.629Z", // the real newest timestamp from the live race
      data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_3", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "rejected" },
    },
  };

  // Sent deliberately OUT of chronological order (rejected -> initiated ->
  // completed) -- the real live race was in-order arrival with an
  // out-of-order DB commit; sending out of order here exercises the same
  // guard property (result must depend only on timestamp, never on
  // arrival/commit order) even more directly.
  for (const key of ["rejected", "initiated", "completed"] as const) {
    const bodyString = JSON.stringify(envelopes[key]);
    const { status } = await post("/withdrawals", bodyString, sign(bodyString));
    assert.equal(status, 200);
  }

  const payment = await pool.query("SELECT status, event_timestamp FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rows[0].status, "rejected", "the newest event by timestamp always wins, regardless of send order");
  assert.equal(payment.rows[0].event_timestamp.toISOString(), "2026-09-23T09:58:54.629Z");

  await cleanupEventId(ids.initiated);
  await cleanupEventId(ids.completed);
  await cleanupEventId(ids.rejected);
  await cleanupPayment(paymentId);
});

test("ordering guard: a brand-new payment always accepts its first event regardless of timestamp", async () => {
  const paymentId = "test_payment_ordering_guard_first_insert";
  const eventId = "test_evt_ordering_guard_first_insert";
  const envelope = {
    event: "withdrawal.initiated",
    eventId,
    timestamp: "2020-01-01T00:00:00.000Z", // deliberately old -- there's nothing stored yet to compare against
    data: { _id: paymentId, userId: "TEST_PLAYER_ORDERING_GUARD_FIRST", paymentType: "withdrawal", amount: 1000, currency: "INR", status: "pending" },
  };
  const bodyString = JSON.stringify(envelope);

  const { status } = await post("/withdrawals", bodyString, sign(bodyString));
  assert.equal(status, 200);

  const payment = await pool.query("SELECT status FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rowCount, 1, "the first event for a payment is never rejected just because its timestamp looks old");
  assert.equal(payment.rows[0].status, "pending");

  await cleanupEventId(eventId);
  await cleanupPayment(paymentId);
});

// reason (added 2026-09-23): admin-typed reason on rejection, provider
// error message on gateway failure, null otherwise. Real example that
// motivated this: withdrawal 6ab39acc0ec99d159c970bb7 was rejected once
// with no reason field at all (evt_6c023ebe22e41454, 09:41:08.919Z), then
// the platform re-fired the SAME rejected status with reason populated
// (evt_81b6fa875f43b87b, 11:22:16.294Z, reason: "no payslip") -- a
// same-status-but-genuinely-newer event, which the ordering guard must
// still accept (its WHERE clause compares timestamps, not whether status
// changed). Real timestamps/reason text reused here; payment id and
// eventIds are this test's own synthetic ones, not the real production
// rows, so cleanup never touches real data.

test("reason: the real re-fired rejection example -- a same-status-but-newer event still updates reason", async () => {
  const paymentId = "test_payment_reason_refired_rejection";
  const firstEventId = "test_evt_reason_refired_first";
  const secondEventId = "test_evt_reason_refired_second";

  const firstRejection = {
    event: "withdrawal.rejected",
    eventId: firstEventId,
    timestamp: "2026-09-23T09:41:08.919Z", // real timestamp from the live example
    data: { _id: paymentId, userId: "TEST_PLAYER_REASON_REFIRED", paymentType: "withdrawal", amount: 9, currency: "usdttrc20", status: "rejected" },
  };
  const secondRejection = {
    event: "withdrawal.rejected",
    eventId: secondEventId,
    timestamp: "2026-09-23T11:22:16.294Z", // real timestamp, genuinely newer
    data: { _id: paymentId, userId: "TEST_PLAYER_REASON_REFIRED", paymentType: "withdrawal", amount: 9, currency: "usdttrc20", status: "rejected", reason: "no payslip" },
  };

  const first = await post("/withdrawals", JSON.stringify(firstRejection), sign(JSON.stringify(firstRejection)));
  assert.equal(first.status, 200);

  let payment = await pool.query("SELECT status, reason FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rows[0].status, "rejected");
  assert.equal(payment.rows[0].reason, null, "no reason field at all on the first event -- stays null, not an error");

  const second = await post("/withdrawals", JSON.stringify(secondRejection), sign(JSON.stringify(secondRejection)));
  assert.equal(second.status, 200);

  payment = await pool.query("SELECT status, reason, event_timestamp FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rows[0].status, "rejected", "status itself is unchanged (rejected -> rejected)");
  assert.equal(payment.rows[0].reason, "no payslip", "but reason is now populated -- the ordering guard compares timestamps, not whether any field's value actually changed");
  assert.equal(payment.rows[0].event_timestamp.toISOString(), "2026-09-23T11:22:16.294Z");

  await cleanupEventId(firstEventId);
  await cleanupEventId(secondEventId);
  await cleanupPayment(paymentId);
});

test("reason: an older event must not overwrite a newer reason, same ordering guard as status", async () => {
  const paymentId = "test_payment_reason_ordering_guard";
  const newerEventId = "test_evt_reason_ordering_guard_newer";
  const olderEventId = "test_evt_reason_ordering_guard_older";

  const newerEnvelope = {
    event: "withdrawal.rejected",
    eventId: newerEventId,
    timestamp: "2026-09-23T11:22:16.294Z",
    data: { _id: paymentId, userId: "TEST_PLAYER_REASON_ORDERING", paymentType: "withdrawal", amount: 9, currency: "usdttrc20", status: "rejected", reason: "no payslip" },
  };
  const olderEnvelope = {
    event: "withdrawal.rejected",
    eventId: olderEventId,
    timestamp: "2026-09-23T09:41:08.919Z",
    data: { _id: paymentId, userId: "TEST_PLAYER_REASON_ORDERING", paymentType: "withdrawal", amount: 9, currency: "usdttrc20", status: "rejected", reason: "wrong wallet id" },
  };

  // Newer event processed first...
  const first = await post("/withdrawals", JSON.stringify(newerEnvelope), sign(JSON.stringify(newerEnvelope)));
  assert.equal(first.status, 200);
  // ...older event arrives second, simulating a late/out-of-order write.
  const second = await post("/withdrawals", JSON.stringify(olderEnvelope), sign(JSON.stringify(olderEnvelope)));
  assert.equal(second.status, 200, "still accepted (200), just doesn't win the upsert");

  const payment = await pool.query("SELECT reason FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rows[0].reason, "no payslip", "the older event's reason must not overwrite the newer one");

  await cleanupEventId(newerEventId);
  await cleanupEventId(olderEventId);
  await cleanupPayment(paymentId);
});

test("reason: absent entirely on an ordinary event (no reason key at all) -- stays null, does not error", async () => {
  const paymentId = "test_payment_reason_absent";
  const eventId = "test_evt_reason_absent";
  const envelope = {
    event: "withdrawal.completed",
    eventId,
    timestamp: "2026-09-23T11:10:17.643Z",
    data: { _id: paymentId, userId: "TEST_PLAYER_REASON_ABSENT", paymentType: "withdrawal", amount: 100, currency: "INR", status: "completed" },
  };
  const bodyString = JSON.stringify(envelope);

  const { status } = await post("/withdrawals", bodyString, sign(bodyString));
  assert.equal(status, 200);

  const payment = await pool.query("SELECT status, reason FROM payments WHERE id = $1", [paymentId]);
  assert.equal(payment.rows[0].status, "completed");
  assert.equal(payment.rows[0].reason, null);

  await cleanupEventId(eventId);
  await cleanupPayment(paymentId);
});
