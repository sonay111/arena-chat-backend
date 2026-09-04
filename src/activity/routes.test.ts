import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { pool } from "../db.js";
import { activityRouter } from "./routes.js";

// Real HTTP request against the actual activityRouter + real Postgres,
// same convention as src/alerts/routes.test.ts. Rows are inserted directly
// into raw_webhook_events (bypassing the HMAC/envelope layer entirely,
// since this endpoint only ever reads that table) with received_at dates
// far in the future (year 2099) so they're guaranteed to sort as the
// newest rows in the table regardless of whatever real 2026 traffic is
// also sitting there from manual testing — that keeps pagination
// assertions exact without needing to control or clear the whole table.

let baseUrl: string;
let server: http.Server;

const EVENT_IDS = {
  page1: "activity_test_pagination_1",
  page2: "activity_test_pagination_2",
  page3: "activity_test_pagination_3",
  excludedTestEventId: "test_activity_exclusion_1",
  excludedTestUser: "activity_test_exclusion_2",
  excludedSyntheticUser: "activity_test_exclusion_3",
};

// Valid-looking 24-char hex Mongo ObjectIds, distinguishable per row.
const USER_IDS = {
  page1: "aaaaaaaaaaaaaaaaaaaa0001",
  page2: "aaaaaaaaaaaaaaaaaaaa0002",
  page3: "aaaaaaaaaaaaaaaaaaaa0003",
  excludedTestUser: "TEST_USER_ACTIVITY_EXCLUDED",
};

let excludedTestEventIdRowId: string;
let excludedTestUserRowId: string;
let excludedSyntheticUserRowId: string;

async function insertRow(opts: {
  route: string;
  eventName: string;
  eventId: string;
  userId: string;
  data: Record<string, unknown>;
  receivedAt: string;
}) {
  const payload = {
    event: opts.eventName,
    eventId: opts.eventId,
    timestamp: opts.receivedAt,
    data: opts.data,
  };
  const { rows } = await pool.query(
    `INSERT INTO raw_webhook_events (route, event_name, event_id, user_id, payload, received_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [opts.route, opts.eventName, opts.eventId, opts.userId, JSON.stringify(payload), opts.receivedAt]
  );
  return String(rows[0].id);
}

before(async () => {
  const app = express();
  app.use(activityRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Three real-looking rows, strictly newest-first, for pagination.
  await insertRow({
    route: "/withdrawals",
    eventName: "withdrawal.initiated",
    eventId: EVENT_IDS.page1,
    userId: USER_IDS.page1,
    data: { amount: 5000, currency: "INR" },
    receivedAt: "2099-01-01T00:00:03.000Z",
  });
  await insertRow({
    route: "/users",
    eventName: "user.registered",
    eventId: EVENT_IDS.page2,
    userId: USER_IDS.page2,
    data: {},
    receivedAt: "2099-01-01T00:00:02.000Z",
  });
  await insertRow({
    route: "/users",
    eventName: "user.registered",
    eventId: EVENT_IDS.page3,
    userId: USER_IDS.page3,
    data: {},
    receivedAt: "2099-01-01T00:00:01.000Z",
  });

  // Excluded: event_id starts with "test_".
  excludedTestEventIdRowId = await insertRow({
    route: "/users",
    eventName: "user.registered",
    eventId: EVENT_IDS.excludedTestEventId,
    userId: "aaaaaaaaaaaaaaaaaaaa0009",
    data: {},
    receivedAt: "2099-01-01T00:00:04.000Z",
  });

  // Excluded: non-hex TEST_-prefixed user id (this repo's test-fixture convention).
  excludedTestUserRowId = await insertRow({
    route: "/users",
    eventName: "user.registered",
    eventId: EVENT_IDS.excludedTestUser,
    userId: USER_IDS.excludedTestUser,
    data: {},
    receivedAt: "2099-01-01T00:00:05.000Z",
  });

  // Excluded: the synthetic all-zeros fixture id used elsewhere in this repo's tests.
  excludedSyntheticUserRowId = await insertRow({
    route: "/withdrawals",
    eventName: "withdrawal.initiated",
    eventId: EVENT_IDS.excludedSyntheticUser,
    userId: "000000000000000000000001",
    data: { amount: 1, currency: "INR" },
    receivedAt: "2099-01-01T00:00:06.000Z",
  });
});

after(async () => {
  await pool.query(
    `DELETE FROM raw_webhook_events WHERE event_id = ANY($1)`,
    [Object.values(EVENT_IDS)]
  );
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("newest-first pagination: page 1 returns the 2 newest VISIBLE rows, skipping excluded ones", async () => {
  // The 3 excluded rows are seeded with the latest timestamps of all
  // (00:00:04–06), specifically to prove exclusion isn't just "these rows
  // happen to sort last" — they'd be first if the filter didn't work.
  const res = await fetch(`${baseUrl}/activity/recent?limit=2`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.items.length, 2);
  assert.equal(body.items[0].userId, USER_IDS.page1, "newest genuine row, not one of the newer-but-excluded rows");
  assert.equal(body.items[1].userId, USER_IDS.page2);
  assert.equal(body.hasMore, true);
  assert.equal(body.nextCursor, "2099-01-01T00:00:02.000Z");
});

test("test-fixture rows are excluded from the feed entirely", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const returnedIds = body.items.map((item: any) => item.id);
  assert.ok(!returnedIds.includes(excludedTestEventIdRowId), "row with a test_-prefixed eventId must not appear");
  assert.ok(!returnedIds.includes(excludedTestUserRowId), "row with a TEST_-prefixed userId must not appear");
  assert.ok(!returnedIds.includes(excludedSyntheticUserRowId), "row with the synthetic all-zeros userId must not appear");

  // The 3 genuine pagination rows, however, must all be present.
  const returnedEventTypes = body.items.map((item: any) => `${item.userId}:${item.timestamp}`);
  assert.ok(returnedEventTypes.includes(`${USER_IDS.page1}:2099-01-01T00:00:03.000Z`));
  assert.ok(returnedEventTypes.includes(`${USER_IDS.page2}:2099-01-01T00:00:02.000Z`));
  assert.ok(returnedEventTypes.includes(`${USER_IDS.page3}:2099-01-01T00:00:01.000Z`));
});

test("cursor-based pagination walks forward through pages without duplicates, oldest reached last", async () => {
  const firstPage = await (
    await fetch(`${baseUrl}/activity/recent?limit=1&before=${encodeURIComponent("2099-01-01T00:00:04.500Z")}`)
  ).json();
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.items[0].userId, USER_IDS.page1);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextCursor, "2099-01-01T00:00:03.000Z");

  const secondPage = await (
    await fetch(`${baseUrl}/activity/recent?limit=1&before=${encodeURIComponent(firstPage.nextCursor)}`)
  ).json();
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.items[0].userId, USER_IDS.page2);
  assert.notEqual(secondPage.items[0].id, firstPage.items[0].id);

  const thirdPage = await (
    await fetch(`${baseUrl}/activity/recent?limit=1&before=${encodeURIComponent(secondPage.nextCursor)}`)
  ).json();
  assert.equal(thirdPage.items.length, 1);
  assert.equal(thirdPage.items[0].userId, USER_IDS.page3);
});

test("withdrawal.initiated produces a description with the real amount and currency", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50`);
  const body = await res.json();
  const item = body.items.find((i: any) => i.userId === USER_IDS.page1);
  assert.ok(item, "expected the seeded withdrawal.initiated row to be present");
  assert.equal(item.eventType, "withdrawal.initiated");
  assert.equal(item.description, "Withdrawal initiated — ₹5000");
});

test("an invalid 'before' cursor is rejected with 400, not a crash", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?before=not-a-real-date`);
  assert.equal(res.status, 400);
});
