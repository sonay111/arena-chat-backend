import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createOddsFeedRouter } from "./routes.js";
import type { GetLiveMatchesResponse } from "../crm/index.js";
import type { CrmLiveMatch } from "../crm/types.js";

// Real HTTP request against the actual router, same convention as every
// other *.routes.test.ts in this repo. GET /live-matches sources from the
// CRM's /crm/live-matches, so fetchLiveMatches (createOddsFeedRouter's
// injectable param) is stubbed here — same rationale as
// checkWithdrawalDelays/createGoalInferenceRouter: no mocking library in
// this project, and real CRM calls depend on our server's IP being
// allowlisted.
//
// Fixture shape reflects Satyam's 2026-09-18 update to this endpoint:
// sportId is now a real field (no more reverse-derivation from sportName),
// producerId/connection are genuinely per-match (the old top-level `feed`
// object is gone), and hasOdds is new.

let baseUrl: string;
let server: http.Server;

function match(overrides: Partial<CrmLiveMatch>): CrmLiveMatch {
  return {
    matchId: "sr:match:0",
    sportId: "sr:sport:1",
    status: "Live",
    sportName: "Soccer",
    team1Name: "Team A",
    team2Name: "Team B",
    tournamentName: "Test League",
    region: "Testland",
    startTime: "2026-09-18T05:00:00.000Z",
    updatedAt: new Date().toISOString(),
    producerId: 1,
    connection: true,
    hasOdds: true,
    ...overrides,
  };
}

const freshSoccerMatch = match({
  matchId: "TEST_FRESH_SOCCER",
  sportId: "sr:sport:1",
  sportName: "Soccer",
  team1Name: "Zhejiang Professional Srl",
  team2Name: "Wuhan Three Towns FC Srl",
  tournamentName: "China Super League SRL",
  region: "Simulated Reality League",
  updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago -- fresh
  producerId: 1,
  connection: true,
});

const suspendedCricketMatch = match({
  matchId: "TEST_SUSPENDED_CRICKET",
  sportId: "sr:sport:21",
  status: "Suspended",
  sportName: "Cricket",
  team1Name: "Japan",
  team2Name: "India",
  tournamentName: "T20 Asian Games, Women",
  region: "International",
  producerId: 5,
  connection: true,
});

const notStartedSnakeCase = match({
  matchId: "TEST_NOT_STARTED_SNAKE",
  sportId: "sr:sport:21",
  status: "not_started", // real casing seen on cricket matches
  sportName: "Cricket",
  team1Name: "Mumbai",
  team2Name: "Kerala",
  producerId: 5,
  connection: true,
});

const notStartedPascalCase = match({
  matchId: "TEST_NOT_STARTED_PASCAL",
  sportId: "sr:sport:5",
  status: "NotStarted", // real casing seen on a tennis match, same live call
  sportName: "Tennis",
  team1Name: "Player One",
  team2Name: "Player Two",
  region: null, // real example: Davis Cup match had region: null
  producerId: 1,
  connection: true,
});

// Real example: no producer link yet correlates with hasOdds: false
// (confirmed live 2026-09-18 -- sr:match:74805984).
const noOddsMatch = match({
  matchId: "TEST_NO_ODDS",
  sportId: "sr:sport:5",
  status: "NotStarted",
  sportName: "Tennis",
  team1Name: "Player Three",
  team2Name: "Player Four",
  producerId: null,
  connection: null,
  hasOdds: false,
});

const staleLiveMatch = match({
  matchId: "TEST_STALE_LIVE",
  sportId: "sr:sport:20",
  sportName: "Table Tennis",
  team1Name: "Stale A",
  team2Name: "Stale B",
  updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), // 7h ago
  producerId: 1,
  connection: true,
});

const unmappedSportMatch = match({
  matchId: "TEST_UNMAPPED_SPORT",
  sportId: "sr:sport:999",
  sportName: "Basketball", // not in our SPORT_MAPPING
  team1Name: "Hoops A",
  team2Name: "Hoops B",
  producerId: 1,
  connection: true,
});

const disconnectedProducerMatch = match({
  matchId: "TEST_DISCONNECTED_PRODUCER",
  sportId: "sr:sport:1",
  team1Name: "Down A",
  team2Name: "Down B",
  producerId: 3,
  connection: false,
});

// The real match a real test bet was placed on (bet _id
// 6aab7d62a41d15d89eb25bd5, settled "lost" 2026-09-17T05:49:18Z) --
// reused here to confirm activeBetCount/settledBetCount joining against
// real DB data still works unchanged now that matches come from the CRM
// instead of our own listener.
const realBetMatch = match({
  matchId: "sr:match:73842246",
  sportId: "sr:sport:1",
  sportName: "Soccer",
  team1Name: "Uzbekistan",
  team2Name: "China PR",
  producerId: 1,
  connection: true,
});

const STUB_RESPONSE: GetLiveMatchesResponse = {
  matches: [
    freshSoccerMatch,
    suspendedCricketMatch,
    notStartedSnakeCase,
    notStartedPascalCase,
    noOddsMatch,
    staleLiveMatch,
    unmappedSportMatch,
    disconnectedProducerMatch,
    realBetMatch,
  ],
  totalData: 9,
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

test("GET /live-matches: maps a CRM match into our response contract, including the new per-match fields", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_FRESH_SOCCER");
  assert.ok(m);
  assert.equal(m.name, "Zhejiang Professional Srl vs. Wuhan Three Towns FC Srl", "team1Name + team2Name combined");
  assert.equal(m.sportId, "sr:sport:1", "sportId comes directly from the CRM now, not reverse-derived");
  assert.equal(m.sportName, "Soccer", "sportName passes through the CRM's own raw value");
  assert.equal(m.sportColor, "#F97316");
  assert.equal(m.tournamentId, null, "CRM has no tournamentId at all");
  assert.equal(m.tournamentName, "China Super League SRL");
  assert.equal(m.categoryName, "Simulated Reality League", "region mapped to categoryName");
  assert.equal(m.isSimulated, true, "region is exactly 'Simulated Reality League'");
  assert.equal(m.countryCode, null, "CRM has no countryCode at all");
  assert.equal(m.event_status, "Live");
  assert.equal(m.scheduledTime, freshSoccerMatch.startTime);
  assert.equal(m.lastUpdatedAt, freshSoccerMatch.updatedAt);
  assert.equal(m.producerStatus, "connected", "this match's own producerId=1/connection=true");
  assert.equal(m.hasOdds, true);
  assert.equal(typeof m.activeBetCount, "number");
  assert.equal(typeof m.totalActiveStake, "object");
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

test("GET /live-matches: isSimulated is false for a real (non-SRL) match, purely informational -- not excluded from results", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_SUSPENDED_CRICKET");
  assert.ok(m, "a non-SRL match must still appear in results");
  assert.equal(m.isSimulated, false);
});

test("GET /live-matches: an unmapped sportId passes sportId/sportName through raw, sportColor null", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_UNMAPPED_SPORT");
  assert.ok(m);
  assert.equal(m.sportId, "sr:sport:999", "a real, unmapped sportId still passes through -- never hidden");
  assert.equal(m.sportName, "Basketball");
  assert.equal(m.sportColor, null);
});

test("GET /live-matches: hasOdds: false matches are NOT excluded, just labeled -- same principle as isSimulated", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const m = body.matches.find((x: any) => x.matchId === "TEST_NO_ODDS");
  assert.ok(m, "a hasOdds: false match must still appear in results");
  assert.equal(m.hasOdds, false);
});

test("GET /live-matches: producerStatus is genuinely per-match now -- different values across different matches in the same response", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const connected = body.matches.find((x: any) => x.matchId === "TEST_FRESH_SOCCER");
  const disconnected = body.matches.find((x: any) => x.matchId === "TEST_DISCONNECTED_PRODUCER");
  const unconfirmed = body.matches.find((x: any) => x.matchId === "TEST_NO_ODDS");

  assert.equal(connected.producerStatus, "connected");
  assert.equal(disconnected.producerStatus, "disconnected");
  assert.equal(unconfirmed.producerStatus, "unconfirmed");

  assert.equal(body.feedStatus, undefined, "the old top-level feedStatus field is gone");
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

test("GET /live-matches: feedHealth.connected reflects a successful CRM call, no more .producers sub-object", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  assert.deepEqual(body.feedHealth, { connected: true });
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
