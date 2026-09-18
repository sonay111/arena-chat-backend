import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createOddsFeedRouter } from "./routes.js";
import type { GetLiveMatchesResponse } from "../crm/index.js";
import type { CrmLiveMatch } from "../crm/types.js";

// Real HTTP request against the actual router, same convention as every
// other *.routes.test.ts in this repo. As of 2026-09-18, GET /live-matches
// sources from the CRM's /crm/live-matches instead of our own socket
// listener, so fetchLiveMatches (createOddsFeedRouter's injectable param)
// is stubbed here — same rationale as checkWithdrawalDelays/
// createGoalInferenceRouter: no mocking library in this project, and real
// CRM calls depend on our server's IP being allowlisted.

let baseUrl: string;
let server: http.Server;

function match(overrides: Partial<CrmLiveMatch>): CrmLiveMatch {
  return {
    matchId: "sr:match:0",
    status: "Live",
    sportName: "Soccer",
    team1Name: "Team A",
    team2Name: "Team B",
    tournamentName: "Test League",
    region: "Testland",
    startTime: "2026-09-18T05:00:00.000Z",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const freshSoccerMatch = match({
  matchId: "TEST_FRESH_SOCCER",
  sportName: "Soccer", // CRM's name for what our own SPORT_MAPPING calls "Football"
  team1Name: "Zhejiang Professional Srl",
  team2Name: "Wuhan Three Towns FC Srl",
  tournamentName: "China Super League SRL",
  region: "Simulated Reality League",
  updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago -- fresh
});

const suspendedCricketMatch = match({
  matchId: "TEST_SUSPENDED_CRICKET",
  status: "Suspended",
  sportName: "Cricket",
  team1Name: "Japan",
  team2Name: "India",
  tournamentName: "T20 Asian Games, Women",
  region: "International",
});

const notStartedSnakeCase = match({
  matchId: "TEST_NOT_STARTED_SNAKE",
  status: "not_started", // real casing seen on cricket matches
  sportName: "Cricket",
  team1Name: "Mumbai",
  team2Name: "Kerala",
});

const notStartedPascalCase = match({
  matchId: "TEST_NOT_STARTED_PASCAL",
  status: "NotStarted", // real casing seen on a tennis match, same live call
  sportName: "Tennis",
  team1Name: "Player One",
  team2Name: "Player Two",
  region: null, // real example: Davis Cup match had region: null
});

const staleLiveMatch = match({
  matchId: "TEST_STALE_LIVE",
  sportName: "Table Tennis",
  team1Name: "Stale A",
  team2Name: "Stale B",
  updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), // 7h ago
});

const unmappedSportMatch = match({
  matchId: "TEST_UNMAPPED_SPORT",
  sportName: "Basketball", // not in our SPORT_MAPPING
  team1Name: "Hoops A",
  team2Name: "Hoops B",
});

// The real match a real test bet was placed on (bet _id
// 6aab7d62a41d15d89eb25bd5, settled "lost" 2026-09-17T05:49:18Z) --
// reused here to confirm activeBetCount/settledBetCount joining against
// real DB data still works unchanged now that matches come from the CRM
// instead of our own listener.
const realBetMatch = match({
  matchId: "sr:match:73842246",
  sportName: "Soccer",
  team1Name: "Uzbekistan",
  team2Name: "China PR",
});

const STUB_RESPONSE: GetLiveMatchesResponse = {
  matches: [
    freshSoccerMatch,
    suspendedCricketMatch,
    notStartedSnakeCase,
    notStartedPascalCase,
    staleLiveMatch,
    unmappedSportMatch,
    realBetMatch,
  ],
  totalData: 7,
  feed: { "1": true, "3": true, "4": true, "5": true },
};

async function stubFetcher(): Promise<GetLiveMatchesResponse> {
  return STUB_RESPONSE;
}

before(async () => {
  const app = express();
  app.use(createOddsFeedRouter(stubFetcher));
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

test("GET /live-matches: maps a CRM match into our unchanged response contract", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_FRESH_SOCCER");
  assert.ok(m);
  assert.equal(m.name, "Zhejiang Professional Srl vs. Wuhan Three Towns FC Srl", "team1Name + team2Name combined");
  assert.equal(m.sportId, "sr:sport:1", "Soccer must resolve to our sr:sport:1 (mapped as Football)");
  assert.equal(m.sportName, "Soccer", "sportName passes through the CRM's own raw value");
  assert.equal(m.sportColor, "#F97316");
  assert.equal(m.tournamentId, null, "CRM has no tournamentId at all");
  assert.equal(m.tournamentName, "China Super League SRL");
  assert.equal(m.categoryName, "Simulated Reality League", "region mapped to categoryName");
  assert.equal(m.countryCode, null, "CRM has no countryCode at all");
  assert.equal(m.event_status, "Live");
  assert.equal(m.scheduledTime, freshSoccerMatch.startTime);
  assert.equal(m.lastUpdatedAt, freshSoccerMatch.updatedAt);
  assert.equal(typeof m.activeBetCount, "number");
  assert.deepEqual(Object.keys(m.settledBetCount).sort(), ["lost", "void", "won"]);
});

test("GET /live-matches: status normalization -- 'not_started' and 'NotStarted' both become our canonical 'NotStarted'", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const snake = body.matches.find((m: any) => m.matchId === "TEST_NOT_STARTED_SNAKE");
  const pascal = body.matches.find((m: any) => m.matchId === "TEST_NOT_STARTED_PASCAL");
  assert.equal(snake.event_status, "NotStarted");
  assert.equal(pascal.event_status, "NotStarted");
});

test("GET /live-matches: a real Suspended match passes through correctly", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_SUSPENDED_CRICKET");
  assert.ok(m);
  assert.equal(m.event_status, "Suspended");
});

test("GET /live-matches: region: null maps to categoryName: null", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_NOT_STARTED_PASCAL");
  assert.equal(m.categoryName, null);
});

test("GET /live-matches: an unmapped sport passes sportName through raw, with sportId/sportColor null", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_UNMAPPED_SPORT");
  assert.ok(m);
  assert.equal(m.sportName, "Basketball");
  assert.equal(m.sportId, null);
  assert.equal(m.sportColor, null);
});

test("GET /live-matches: feed connection status is a single top-level field, not repeated per match", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  assert.equal(body.feedStatus, "connected", "every producer in the stub feed reports true");
  const m = body.matches.find((x: any) => x.matchId === "TEST_FRESH_SOCCER");
  assert.equal(m.producerId, undefined, "producerId is a dead field now that feed status is top-level -- removed entirely");
  assert.equal(m.producerStatus, undefined, "producerStatus must no longer appear per-match");
});

test("GET /live-matches: feedStatus is 'degraded' (not 'unconfirmed') on a real mixed feed result", async () => {
  const app = express();
  app.use(
    createOddsFeedRouter(async () => ({
      matches: [freshSoccerMatch],
      totalData: 1,
      feed: { "1": true, "3": false },
    }))
  );
  const mixedServer = http.createServer(app);
  await new Promise<void>((resolve) => mixedServer.listen(0, resolve));
  const address = mixedServer.address();
  if (typeof address !== "object" || address === null) throw new Error("failed to bind");
  const mixedBaseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const res = await fetch(`${mixedBaseUrl}/live-matches`);
    const body = await res.json();
    assert.equal(body.feedStatus, "degraded");
  } finally {
    await new Promise<void>((resolve, reject) => mixedServer.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /live-matches: activeBetCount/settledBetCount still join correctly on matchId against real DB data", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "sr:match:73842246");
  assert.ok(m, "expected the real bet-history match to appear");
  assert.equal(m.activeBetCount, 0, "the real bet on this match has already settled");
  assert.deepEqual(m.settledBetCount, { won: 0, lost: 1, void: 0 });
});

test("GET /live-matches?status=Live: excludes a match whose lastUpdatedAt is older than 6 hours by default", async () => {
  const res = await fetch(`${baseUrl}/live-matches?status=Live`);
  const body = await res.json();
  const matchIds = body.matches.map((m: any) => m.matchId);

  assert.ok(!matchIds.includes("TEST_STALE_LIVE"));
  assert.ok(matchIds.includes("TEST_FRESH_SOCCER"));
  assert.ok(body.staleExcludedCount >= 1);
});

test("GET /live-matches?status=Live&includeStale=true: bypasses the staleness filter", async () => {
  const res = await fetch(`${baseUrl}/live-matches?status=Live&includeStale=true`);
  const body = await res.json();
  const matchIds = body.matches.map((m: any) => m.matchId);

  assert.ok(matchIds.includes("TEST_STALE_LIVE"));
  assert.equal(body.staleExcludedCount, 0);
});

test("GET /live-matches (no status filter): the staleness filter does not apply, even to an old match", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();
  const matchIds = body.matches.map((m: any) => m.matchId);

  assert.ok(matchIds.includes("TEST_STALE_LIVE"));
  assert.equal(body.staleExcludedCount, 0);
});

test("GET /live-matches?status=Live: only returns matches with that normalized event_status", async () => {
  const res = await fetch(`${baseUrl}/live-matches?status=Live`);
  const body = await res.json();
  const matchIds = body.matches.map((m: any) => m.matchId);

  assert.ok(matchIds.includes("TEST_FRESH_SOCCER"));
  assert.ok(!matchIds.includes("TEST_SUSPENDED_CRICKET"));
  assert.ok(!matchIds.includes("TEST_NOT_STARTED_SNAKE"));
});

test("GET /live-matches?tournamentId=...: known limitation -- always excludes everything, since the CRM never provides a tournamentId", async () => {
  const res = await fetch(`${baseUrl}/live-matches?tournamentId=sr:tournament:anything`);
  const body = await res.json();
  assert.equal(body.matches.length, 0);
});

test("GET /live-matches: feedHealth.connected reflects a successful CRM call, producers built from the CRM's feed object", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  assert.equal(body.feedHealth.connected, true);
  assert.deepEqual(Object.keys(body.feedHealth.producers).sort(), ["1", "3", "4", "5"]);
  assert.equal(body.feedHealth.producers["1"].raw.connection, true);
});

test("GET /live-matches: a failed CRM call returns 500, not a partial/broken response", async () => {
  const app = express();
  app.use(
    createOddsFeedRouter(async () => {
      throw new Error("simulated CRM failure");
    })
  );
  const failServer = http.createServer(app);
  await new Promise<void>((resolve) => failServer.listen(0, resolve));
  const address = failServer.address();
  if (typeof address !== "object" || address === null) throw new Error("failed to bind");
  const failBaseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const res = await fetch(`${failBaseUrl}/live-matches`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { ok: false });
  } finally {
    await new Promise<void>((resolve, reject) => failServer.close((err) => (err ? reject(err) : resolve())));
  }
});

test("GET /live-matches/:matchId/bets: returns our real settled bet with all fields sourced correctly", async () => {
  const res = await fetch(`${baseUrl}/live-matches/sr:match:73842246/bets`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.openBets.length, 0, "the bet has settled, it must not also appear as open");
  const bet = body.settledBets.find((b: any) => b.betId === "6aab7d62a41d15d89eb25bd5");
  assert.ok(bet, "expected our real settled bet to appear");
  assert.equal(bet.playerId, "6a8e9b7f2ae5ea6dac1ce929");
  assert.equal(bet.stake, 2);
  assert.equal(bet.odds, 1.35, "odds should be backfilled from the original bet_placed event");
  assert.equal(bet.marketName, "1st half - 1x2");
  assert.equal(bet.status, "lost");
  assert.equal(bet.timestamp, "2026-09-17T05:40:50.012Z");
});

test("GET /live-matches/:matchId/bets: a match with no real bets returns empty arrays, not an error", async () => {
  const res = await fetch(`${baseUrl}/live-matches/sr:match:does-not-exist/bets`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { openBets: [], settledBets: [] });
});
