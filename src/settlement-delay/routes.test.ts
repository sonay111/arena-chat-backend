import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createSettlementDelayRouter } from "./routes.js";
import type { SportsbookBet, CrmLiveMatch } from "../crm/index.js";

// Real HTTP request against the actual router, both CRM dependencies
// stubbed (createSettlementDelayRouter's injectable fetchPendingBets/
// fetchLiveMatches) -- same convention as odds-feed/service-health routes.

let baseUrl: string;
let server: http.Server;

// Real fixtures, same ones detect.test.ts uses.
const stubPendingBets: SportsbookBet[] = [
  {
    _id: "6ab216808da72b1a3a675bc7",
    userId: "6a4257cf126678e77124ce98",
    stakeAmount: 200,
    returnAmount: 650,
    winLossAmount: 450,
    eventMarketInformation: { matchId: "sr:match:74559842" },
    betDateTime: "2026-09-22T05:47:44.484Z",
    status: "pending",
  },
  {
    _id: "6a9520d1c16e52500924b3ee",
    userId: "6a8c4143fcfb41d24e07e577",
    stakeAmount: 10000,
    returnAmount: 24500,
    winLossAmount: 14500,
    eventMarketInformation: { matchId: "sr:match:73281486" },
    betDateTime: "2026-08-31T06:36:01.058Z",
    status: "pending",
  },
];

const stubLiveMatches: CrmLiveMatch[] = [
  {
    matchId: "sr:match:74559842",
    sportId: "sr:sport:21",
    status: "Live",
    sportName: "Cricket",
    team1Name: "India A",
    team2Name: "Australia A",
    tournamentName: "First Class Series India A vs Australia A",
    region: "International",
    startTime: "2026-09-22T04:00:00.000Z",
    updatedAt: "2026-09-24T07:21:22.877Z",
    producerId: 5,
    connection: true,
    hasOdds: true,
  },
];

before(async () => {
  const app = express();
  app.use(
    createSettlementDelayRouter(
      async () => stubPendingBets,
      async () => ({ matches: stubLiveMatches, totalData: stubLiveMatches.length })
    )
  );
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

test("GET /settlement-delays: the still-Live bet is absent, the feed-absent bet is flagged", async () => {
  const res = await fetch(`${baseUrl}/settlement-delays`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.overdueBets.length, 1);
  assert.equal(body.overdueBets[0].betId, "6a9520d1c16e52500924b3ee");
  assert.equal(body.overdueBets[0].reason, "match_absent_from_feed");
  assert.equal(body.overdueBets[0].stakeAmount, 10000);

  assert.equal(body.byMatch.length, 1);
  assert.equal(body.byMatch[0].matchId, "sr:match:73281486");
  assert.equal(body.byMatch[0].overdueBetCount, 1);
  assert.equal(body.byMatch[0].totalOverdueStake, 10000);
});

test("GET /settlement-delays: a CRM failure returns 500 rather than a partial body", async () => {
  const app = express();
  app.use(
    createSettlementDelayRouter(
      async () => {
        throw new Error("CRM sportsbook-data unreachable");
      },
      async () => ({ matches: [], totalData: 0 })
    )
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
