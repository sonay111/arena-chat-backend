import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { webhooksRouter } from "./index.js";
import { pool } from "../db.js";

// Real end-to-end tests, same convention as webhooks.test.ts — real HTTP
// against the actual webhooksRouter, real Postgres. /sportsbook and
// /casino had zero test coverage before this file; the field-mapping bug
// fixed here (amount read from a field that never existed, legs[] not
// handled at all) was only caught by inspecting real live traffic, not by
// any test. Payload shapes below are the real confirmed shapes (captured
// live 2026-10-02, see src/webhooks/bets.ts's comments) — only
// _id/eventId/userId are swapped for synthetic test-only values so this
// never collides with a real row in the shared dev DB.

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

async function post(path: string, bodyString: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Signature": sign(bodyString) },
    body: bodyString,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function cleanupBet(id: string) {
  await pool.query("DELETE FROM bets WHERE id = $1", [id]);
}

test("sportsbook.bet_placed, single leg: stakeAmount lands in amount, legs stored as a 1-entry array", async () => {
  const betId = "test_bet_single_leg";
  const envelope = {
    event: "sportsbook.bet_placed",
    eventId: "test_evt_bet_single_leg",
    timestamp: "2026-09-29T07:23:17.273Z",
    data: {
      _id: betId,
      legs: [{ odds: 3.2, matchId: "sr:match:75014776" }],
      odds: 3.2,
      status: "open",
      userId: "TEST_BET_USER_1",
      currency: "INR",
      betDateTime: "2026-09-29T07:23:06.752Z",
      stakeAmount: 250,
      eventMarketInformation: {
        betName: "",
        matchId: "sr:match:75014776",
        teamName: "Victoria",
        marketName: "Winner (incl. super over)",
        sportsType: "sr:sport:21",
        tournamentName: "Victoria vs South Australian Scorpions",
      },
    },
  };
  const bodyString = JSON.stringify(envelope);

  try {
    const { status, body } = await post("/sportsbook", bodyString);
    assert.equal(status, 200);
    assert.equal(body?.ok, true);

    const { rows } = await pool.query(
      "SELECT amount, return_amount, status, category, legs FROM bets WHERE id = $1",
      [betId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, "250");
    assert.equal(rows[0].return_amount, null);
    assert.equal(rows[0].status, "open");
    assert.equal(rows[0].category, "sportsbook");
    assert.deepEqual(rows[0].legs, [{ odds: 3.2, matchId: "sr:match:75014776" }]);
  } finally {
    await cleanupBet(betId);
  }
});

test("sportsbook.bet_placed, multi-leg (parlay): all legs stored in order", async () => {
  const betId = "test_bet_multi_leg";
  const envelope = {
    event: "sportsbook.bet_placed",
    eventId: "test_evt_bet_multi_leg",
    timestamp: "2026-10-01T13:24:50.490Z",
    data: {
      _id: betId,
      legs: [
        {
          odds: 1.27,
          betName: "",
          matchId: "sr:match:75030430",
          marketName: "2nd innings over 14 - 3rd delivery India A total",
        },
        {
          odds: 1.8,
          betName: "",
          matchId: "sr:match:74601420",
          marketName: "2nd innings over 3 - State Bank total",
        },
      ],
      odds: 2.286,
      status: "open",
      userId: "TEST_BET_USER_2",
      currency: "USDT",
      betDateTime: "2026-10-01T13:24:40.111Z",
      stakeAmount: 1,
      eventMarketInformation: {
        betName: "Multi Bet",
        matchId: "",
        teamName: "",
        marketName: "Multi Bet",
        sportsType: "",
        tournamentName: "",
      },
    },
  };
  const bodyString = JSON.stringify(envelope);

  try {
    const { status } = await post("/sportsbook", bodyString);
    assert.equal(status, 200);

    const { rows } = await pool.query("SELECT amount, legs FROM bets WHERE id = $1", [betId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, "1");
    assert.equal(rows[0].legs.length, 2);
    assert.equal(rows[0].legs[0].matchId, "sr:match:75030430");
    assert.equal(rows[0].legs[1].matchId, "sr:match:74601420");
  } finally {
    await cleanupBet(betId);
  }
});

test("sportsbook.bet_settled (no legs in the real payload) does not null out legs already stored by bet_placed", async () => {
  const betId = "test_bet_settle_preserves_legs";
  const placedEnvelope = {
    event: "sportsbook.bet_placed",
    eventId: "test_evt_bet_settle_placed",
    timestamp: "2026-10-01T12:08:00.000Z",
    data: {
      _id: betId,
      legs: [{ odds: 1.9, matchId: "sr:match:74293208" }],
      status: "open",
      userId: "TEST_BET_USER_3",
      currency: "INR",
      betDateTime: "2026-10-01T12:08:00.000Z",
      stakeAmount: 300,
    },
  };

  // Real settled shape, confirmed live 2026-10-02 — no legs field at all.
  const settledEnvelope = {
    event: "sportsbook.bet_settled",
    eventId: "test_evt_bet_settle_settled",
    timestamp: "2026-10-01T12:48:15.485Z",
    data: {
      _id: betId,
      status: "won",
      userId: "TEST_BET_USER_3",
      currency: "INR",
      betDateTime: "2026-10-01T12:08:26.232Z",
      stakeAmount: 300,
      returnAmount: 570,
      winLossAmount: 270,
      eventMarketInformation: {
        betName: "",
        matchId: "sr:match:74293208",
        teamName: "over 174.5",
        marketName: "1st innings - Garden Route Badgers total",
        sportsType: "sr:sport:21",
        tournamentName: "Garden Route Badgers vs Eastern Cape Linyathi",
      },
    },
  };

  try {
    const placedBody = JSON.stringify(placedEnvelope);
    const { status: placedStatus } = await post("/sportsbook", placedBody);
    assert.equal(placedStatus, 200);

    const afterPlaced = await pool.query("SELECT legs FROM bets WHERE id = $1", [betId]);
    assert.equal(afterPlaced.rows[0].legs.length, 1);

    const settledBody = JSON.stringify(settledEnvelope);
    const { status: settledStatus } = await post("/sportsbook", settledBody);
    assert.equal(settledStatus, 200);

    const afterSettled = await pool.query(
      "SELECT status, amount, return_amount, legs FROM bets WHERE id = $1",
      [betId]
    );
    assert.equal(afterSettled.rows[0].status, "won");
    assert.equal(afterSettled.rows[0].amount, "300");
    assert.equal(afterSettled.rows[0].return_amount, "570");
    // The actual fix under test: legs survives the settle update even
    // though the settled payload never mentions it.
    assert.equal(afterSettled.rows[0].legs.length, 1);
    assert.equal(afterSettled.rows[0].legs[0].matchId, "sr:match:74293208");
  } finally {
    await cleanupBet(betId);
  }
});
