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
  betWon: "activity_test_bet_won",
  betLost: "activity_test_bet_lost",
  casinoWon: "activity_test_casino_won",
  casinoLost: "activity_test_casino_lost",
};

// Valid-looking 24-char hex Mongo ObjectIds, distinguishable per row.
const USER_IDS = {
  page1: "aaaaaaaaaaaaaaaaaaaa0001",
  page2: "aaaaaaaaaaaaaaaaaaaa0002",
  page3: "aaaaaaaaaaaaaaaaaaaa0003",
  excludedTestUser: "TEST_USER_ACTIVITY_EXCLUDED",
  betWon: "cccccccccccccccccccc0001",
  betLost: "cccccccccccccccccccc0002",
  casinoWon: "dddddddddddddddddddd0001",
  casinoLost: "dddddddddddddddddddd0002",
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

  // A won and a lost bet, real payload shape, for the outcome/tournamentName
  // shape tests below.
  await insertRow({
    route: "/sportsbook",
    eventName: "sportsbook.bet_settled",
    eventId: EVENT_IDS.betWon,
    userId: USER_IDS.betWon,
    data: {
      status: "won",
      currency: "USDT",
      stakeAmount: 5,
      returnAmount: 7.75,
      winLossAmount: 2.75,
      eventMarketInformation: {
        teamName: "over 0.5",
        marketName: "1st innings over 2 - 3rd delivery Mi Cape Town SRL total",
        tournamentName: "Mi Cape Town SRL vs Durban Super Giants SRL",
      },
    },
    // Deliberately dated BEFORE the 2099-01-01 pagination block above (not
    // after) so these two rows never leak into the "top 2 of the whole
    // feed" assertions in the pagination tests, which fetch with no
    // eventType filter.
    receivedAt: "2098-01-01T00:00:00.000Z",
  });
  await insertRow({
    route: "/sportsbook",
    eventName: "sportsbook.bet_settled",
    eventId: EVENT_IDS.betLost,
    userId: USER_IDS.betLost,
    data: {
      status: "lost",
      currency: "USDT",
      stakeAmount: 2,
      returnAmount: 0,
      winLossAmount: -2,
      eventMarketInformation: {
        teamName: "South Delhi Superstars",
        marketName: "Winner (incl. super over)",
        tournamentName: "North Delhi Strikers vs South Delhi Superstars",
      },
    },
    receivedAt: "2098-01-01T00:00:01.000Z",
  });

  // A won and a lost casino session, real payload shape (simpler than
  // bets — no eventMarketInformation, just a flat gameName).
  await insertRow({
    route: "/casino",
    eventName: "casino.session_settled",
    eventId: EVENT_IDS.casinoWon,
    userId: USER_IDS.casinoWon,
    data: {
      status: "won",
      currency: "INR",
      gameName: "spb_aviator",
      stakeAmount: 500,
      gameProvider: "spb",
      returnAmount: 575,
      winLossAmount: 75,
    },
    receivedAt: "2098-01-01T00:00:02.000Z",
  });
  await insertRow({
    route: "/casino",
    eventName: "casino.session_settled",
    eventId: EVENT_IDS.casinoLost,
    userId: USER_IDS.casinoLost,
    data: {
      status: "lost",
      currency: "INR",
      gameName: "spb_aviator",
      stakeAmount: 100,
      gameProvider: "spb",
      returnAmount: 0,
      winLossAmount: -100,
    },
    receivedAt: "2098-01-01T00:00:03.000Z",
  });
});

const SUMMARY_EVENT_IDS = [
  "activity_test_summary_bonus_mostrecent",
  "activity_test_summary_bonus_within24h",
  "activity_test_summary_bonus_outside24h",
  "activity_test_summary_bonus_excluded",
];

after(async () => {
  await pool.query(
    `DELETE FROM raw_webhook_events WHERE event_id = ANY($1)`,
    [[...Object.values(EVENT_IDS), ...SUMMARY_EVENT_IDS]]
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

test("a won bet has the richer description plus outcome + tournamentName in the actual JSON response", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50`);
  const body = await res.json();
  const item = body.items.find((i: any) => i.userId === USER_IDS.betWon);

  assert.ok(item, "expected the seeded won-bet row to be present");
  assert.equal(
    item.description,
    "Bet won — 7.75 USDT returned (1st innings over 2 - 3rd delivery Mi Cape Town SRL total)"
  );
  assert.equal(item.outcome, "won");
  assert.equal(item.tournamentName, "Mi Cape Town SRL vs Durban Super Giants SRL");
});

test("a lost bet has the richer description plus outcome + tournamentName in the actual JSON response", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50`);
  const body = await res.json();
  const item = body.items.find((i: any) => i.userId === USER_IDS.betLost);

  assert.ok(item, "expected the seeded lost-bet row to be present");
  assert.equal(item.description, "Bet lost — 2 USDT staked (Winner (incl. super over))");
  assert.equal(item.outcome, "lost");
  assert.equal(item.tournamentName, "North Delhi Strikers vs South Delhi Superstars");
});

test("non-bet items have no outcome/tournamentName keys at all in the actual JSON response", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50`);
  const body = await res.json();
  const item = body.items.find((i: any) => i.userId === USER_IDS.page1); // withdrawal.initiated

  assert.ok(item, "expected the seeded withdrawal row to be present");
  assert.ok(!("outcome" in item), "a non-bet item must not have an outcome key, not even undefined");
  assert.ok(!("tournamentName" in item), "a non-bet item must not have a tournamentName key, not even undefined");
});

test("a won casino session has the richer description plus outcome, but no tournamentName key", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50`);
  const body = await res.json();
  const item = body.items.find((i: any) => i.userId === USER_IDS.casinoWon);

  assert.ok(item, "expected the seeded won-casino-session row to be present");
  assert.equal(item.description, "Casino session won — ₹575 returned (spb_aviator)");
  assert.equal(item.outcome, "won");
  assert.ok(!("tournamentName" in item), "casino sessions have no tournament equivalent — key must be absent");
});

test("a lost casino session has the richer description plus outcome (defensive branch, no real example on file)", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50`);
  const body = await res.json();
  const item = body.items.find((i: any) => i.userId === USER_IDS.casinoLost);

  assert.ok(item, "expected the seeded lost-casino-session row to be present");
  assert.equal(item.description, "Casino session lost — ₹100 staked (spb_aviator)");
  assert.equal(item.outcome, "lost");
});

test("eventType filter restricts to just the matching event type", async () => {
  const res = await fetch(`${baseUrl}/activity/recent?limit=50&eventType=withdrawal.initiated`);
  const body = await res.json();

  const ourRows = body.items.filter((i: any) =>
    [USER_IDS.page1, USER_IDS.page2, USER_IDS.page3].includes(i.userId)
  );
  assert.equal(ourRows.length, 1, "only the withdrawal.initiated row should match, not the 2 user.registered rows");
  assert.equal(ourRows[0].userId, USER_IDS.page1);
});

test("eventType accepts a comma-separated list, e.g. for a whole category", async () => {
  const res = await fetch(
    `${baseUrl}/activity/recent?limit=50&eventType=withdrawal.initiated,user.registered`
  );
  const body = await res.json();

  const ourUserIds = body.items
    .map((i: any) => i.userId)
    .filter((id: string) => [USER_IDS.page1, USER_IDS.page2, USER_IDS.page3].includes(id));
  assert.deepEqual(new Set(ourUserIds), new Set([USER_IDS.page1, USER_IDS.page2, USER_IDS.page3]));
});

test("/activity/summary: count24h reflects only genuinely recent, non-excluded events; mostRecent ignores the time window", async () => {
  const baseline = await (await fetch(`${baseUrl}/activity/summary`)).json();
  const baselineCount = baseline.categories.bonuses.count24h;

  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

  // Future-dated, guaranteed to be the absolute newest bonus event overall
  // regardless of any real concurrent traffic in this shared dev DB — this
  // is what mostRecent should point to, and it must NOT count toward
  // count24h (it's outside the "now() and before" window).
  const mostRecentRowId = await insertRow({
    route: "/bonuses",
    eventName: "bonus.activated",
    eventId: "activity_test_summary_bonus_mostrecent",
    userId: "bbbbbbbbbbbbbbbbbbbb0001",
    data: { bonusAmount: 500, currency: "INR" },
    receivedAt: "2099-06-01T00:00:00.000Z",
  });

  // Genuinely within the last 24 real hours — must increment count24h by
  // exactly 1, but must NOT become mostRecent (the future row above wins).
  await insertRow({
    route: "/bonuses",
    eventName: "bonus.activated",
    eventId: "activity_test_summary_bonus_within24h",
    userId: "bbbbbbbbbbbbbbbbbbbb0002",
    data: { bonusAmount: 100, currency: "INR" },
    receivedAt: oneHourAgo,
  });

  // Real, but 3 days old — outside the 24h window, must not affect count24h.
  await insertRow({
    route: "/bonuses",
    eventName: "bonus.activated",
    eventId: "activity_test_summary_bonus_outside24h",
    userId: "bbbbbbbbbbbbbbbbbbbb0003",
    data: { bonusAmount: 50, currency: "INR" },
    receivedAt: threeDaysAgo,
  });

  // Same exclusion logic as /activity/recent must apply here too: a
  // TEST_-prefixed userId, dated even further in the future than the
  // legitimate mostRecent row above — if exclusion weren't applied to
  // /activity/summary, this would incorrectly steal the mostRecent slot.
  await insertRow({
    route: "/bonuses",
    eventName: "bonus.activated",
    eventId: "activity_test_summary_bonus_excluded",
    userId: "TEST_USER_SUMMARY_EXCLUDED",
    data: { bonusAmount: 999999, currency: "INR" },
    receivedAt: "2099-12-31T00:00:00.000Z",
  });

  const after = await (await fetch(`${baseUrl}/activity/summary`)).json();
  const bonuses = after.categories.bonuses;

  assert.equal(bonuses.count24h, baselineCount + 1, "exactly one of the four new rows falls in the real last-24h window");
  assert.ok(bonuses.mostRecent, "expected a mostRecent bonus item");
  assert.equal(bonuses.mostRecent.id, mostRecentRowId, "mostRecent must be the genuine newest row, not the excluded test row");
  assert.equal(bonuses.mostRecent.description, "Bonus activated");
});
