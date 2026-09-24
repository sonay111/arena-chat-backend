import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createSettlementDelayRouter } from "./routes.js";
import type { UnsettledBetsResult } from "./unsettled-bets.js";

// Real HTTP request against the actual router, the single CRM dependency
// stubbed (createSettlementDelayRouter's injectable fetchUnsettledBets) --
// same convention as odds-feed/service-health routes.

let baseUrl: string;
let server: http.Server;

// Real fixture from the live /crm/all-unsettled-bets call, 2026-09-24.
const stubResult: UnsettledBetsResult = {
  bets: [
    {
      _id: "6a8fe3de933517fed4fbf3a0",
      userId: "6a8e9b7f2ae5ea6dac1ce929",
      stakeAmount: 3,
      returnAmount: 4.71,
      winLossAmount: 1.71,
      eventMarketInformation: {
        matchId: "sr:match:73285234",
        marketId: "363",
        marketName: "1st innings over 1 - 1st delivery Melbourne Renegades SRL total",
        betTitle: "over 0.5",
        teamName: "over 0.5",
        tournamentName: "Brisbane Heat SRL vs Melbourne Renegades SRL",
        sportsType: "sr:sport:21",
      },
      betDateTime: "2026-08-27T07:14:38.815Z",
      status: "pending",
    },
    {
      _id: "6a146647d4c280c6b65205e2",
      userId: "6a1465c44f20d11059ee424b",
      stakeAmount: 5,
      returnAmount: 8.5,
      winLossAmount: 3.5,
      eventMarketInformation: {
        matchId: "sr:match:71501210",
        marketId: "357",
        marketName: "1st innings over 11 - Paarl Royals SRL total",
        betTitle: "over 7.5",
        teamName: "over 7.5",
        tournamentName: "Mi Cape Town SRL vs Paarl Royals SRL",
        sportsType: "sports",
      },
      betDateTime: "2026-05-25T15:09:59.598Z",
      status: "pending",
    },
  ],
  summary: {
    totalStakeAmount: 8,
    averageBetAmount: 4,
    winLossAmount: 5.21,
    customerGGR: -5.21,
    customerNGR: -5.21,
  },
};

before(async () => {
  const app = express();
  app.use(createSettlementDelayRouter(async () => stubResult));
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
});

test("GET /settlement-delays: both real bets appear as overdue, grouped by match", async () => {
  const res = await fetch(`${baseUrl}/settlement-delays`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.overdueBets.length, 2);
  assert.deepEqual(
    body.overdueBets.map((b: any) => b.betId),
    ["6a8fe3de933517fed4fbf3a0", "6a146647d4c280c6b65205e2"]
  );
  assert.equal(body.overdueBets[0].reason, "confirmed_unsettled_by_platform");

  assert.equal(body.byMatch.length, 2);
});

test("GET /settlement-delays: summary is the endpoint's own real aggregate, not re-summed", async () => {
  const res = await fetch(`${baseUrl}/settlement-delays`);
  const body = await res.json();

  assert.deepEqual(body.summary, {
    totalStakeAmount: 8,
    averageBetAmount: 4,
    winLossAmount: 5.21,
    customerGGR: -5.21,
    customerNGR: -5.21,
  });
});

test("GET /settlement-delays: a CRM failure returns 500 rather than a partial body", async () => {
  const app = express();
  app.use(
    createSettlementDelayRouter(async () => {
      throw new Error("CRM unsettled-bets unreachable");
    })
  );
  const failingServer = http.createServer(app);
  await new Promise<void>((resolve) => failingServer.listen(0, resolve));
  const address = failingServer.address();
  if (typeof address !== "object" || address === null) throw new Error("failed to bind");
  const failingBaseUrl = `http://127.0.0.1:${address.port}`;

  const res = await fetch(`${failingBaseUrl}/settlement-delays`);
  assert.equal(res.status, 500);

  await new Promise<void>((resolve, reject) => failingServer.close((err) => (err ? reject(err) : resolve())));
});
