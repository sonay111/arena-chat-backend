import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { oddsFeedRouter } from "./routes.js";
import { matchStore, feedStatusStore } from "./connection.js";
import type { MatchState } from "./state.js";

// Real HTTP request against the actual router, same convention as every
// other *.routes.test.ts in this repo — but there's no DB/CRM involved
// here at all, so fixtures are just direct Map inserts into the same
// matchStore/feedStatusStore the route reads from (no network, no
// startOddsFeed() call — this test never opens a real socket).

let baseUrl: string;
let server: http.Server;

const liveMatch: MatchState = {
  matchId: "TEST_LIVE_1",
  name: "Test A vs Test B",
  sportId: "sr:sport:5",
  tournamentId: "sr:tournament:2472",
  tournamentName: "Test Open",
  categoryName: "Testland",
  countryCode: "TST",
  eventStatus: "Live",
  scheduledTime: "Wed Sep 16 09:30:00 UTC 2026",
  lastTimestamp: 1000,
  producerId: "1", // connected, per the feedStatusStore fixture below
};

const notStartedMatch: MatchState = {
  matchId: "TEST_NOTSTARTED_1",
  name: "Test C vs Test D",
  sportId: "sr:sport:1",
  tournamentId: "sr:tournament:9999",
  tournamentName: "Other Test Cup",
  categoryName: "Otherland",
  countryCode: "OTH",
  eventStatus: "NotStarted",
  scheduledTime: "Wed Sep 16 12:00:00 UTC 2026",
  producerId: "2", // disconnected, per the feedStatusStore fixture below
};

const unknownProducerMatch: MatchState = {
  matchId: "TEST_UNKNOWN_PRODUCER_1",
  name: "Test E vs Test F",
  sportId: "sr:sport:1",
  eventStatus: "Live",
  // deliberately no producerId at all -- e.g. only ever seen via
  // match_status, never a real odds message.
};

const neverReportedProducerMatch: MatchState = {
  matchId: "TEST_NEVER_REPORTED_1",
  name: "Test G vs Test H",
  sportId: "sr:sport:1",
  eventStatus: "Live",
  producerId: "4", // has a producerId, but "4" never appears in feedStatusStore below
};

// The real match a real test bet was placed on live 2026-09-17 (bet _id
// 6aab7d62a41d15d89eb25bd5, confirmed via raw_webhook_events). Used to
// verify activeBetCount against real, already-persisted data rather than
// a synthetic fixture — same "real captured data" convention as
// src/crm/endpoints.test.ts. This bet has since settled (lost, at
// 2026-09-17T05:49:18Z) — see the test below, which now checks the
// settled-exclusion path rather than the "still open" one.
const realBetTestMatch: MatchState = {
  matchId: "sr:match:73842246",
  name: "Uzbekistan vs. China PR",
  sportId: "sr:sport:1",
  tournamentId: "sr:tournament:26006",
  tournamentName: "Asian Games, Women",
  categoryName: "International",
  eventStatus: "Live",
};

const tableTennisMatch: MatchState = {
  matchId: "TEST_TABLE_TENNIS_1",
  name: "Test Player vs Test Player 2",
  sportId: "sr:sport:20", // mapped -- see sport-mapping.ts
  eventStatus: "Live",
};

const cricketMatch: MatchState = {
  matchId: "TEST_CRICKET_1",
  name: "Test XI vs Test XI 2",
  sportId: "sr:sport:21", // mapped -- see sport-mapping.ts
  eventStatus: "Live",
};

// A sportId that will never realistically get mapped, so the
// null/null-fallback test doesn't silently break the next time a real
// sport gets confirmed and added to SPORT_MAPPING (sr:sport:5 and
// sr:sport:1, used by other fixtures below, both became mapped after
// this test file was first written).
const unmappedSportMatch: MatchState = {
  matchId: "TEST_UNMAPPED_SPORT_1",
  name: "Test Unmapped A vs Test Unmapped B",
  sportId: "sr:sport:999999",
  eventStatus: "Live",
};

before(async () => {
  const app = express();
  app.use(oddsFeedRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  matchStore.set(liveMatch.matchId, liveMatch);
  matchStore.set(notStartedMatch.matchId, notStartedMatch);
  matchStore.set(unknownProducerMatch.matchId, unknownProducerMatch);
  matchStore.set(neverReportedProducerMatch.matchId, neverReportedProducerMatch);
  matchStore.set(realBetTestMatch.matchId, realBetTestMatch);
  matchStore.set(tableTennisMatch.matchId, tableTennisMatch);
  matchStore.set(cricketMatch.matchId, cricketMatch);
  matchStore.set(unmappedSportMatch.matchId, unmappedSportMatch);
  feedStatusStore.set("1", { raw: { producer_id: 1, connection: true }, receivedAt: 100 });
  feedStatusStore.set("2", { raw: { producer_id: 2, connection: false }, receivedAt: 200 });
});

after(async () => {
  matchStore.delete(liveMatch.matchId);
  matchStore.delete(notStartedMatch.matchId);
  matchStore.delete(unknownProducerMatch.matchId);
  matchStore.delete(neverReportedProducerMatch.matchId);
  matchStore.delete(realBetTestMatch.matchId);
  matchStore.delete(tableTennisMatch.matchId);
  matchStore.delete(cricketMatch.matchId);
  matchStore.delete(unmappedSportMatch.matchId);
  feedStatusStore.delete("1");
  feedStatusStore.delete("2");
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("GET /live-matches: returns matches in the documented shape (event_status, not eventStatus), producerStatus 'connected' for a connected producer", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const match = body.matches.find((m: any) => m.matchId === liveMatch.matchId);
  assert.ok(match, "expected the seeded live match to appear");
  assert.deepEqual(match, {
    matchId: "TEST_LIVE_1",
    name: "Test A vs Test B",
    sportId: "sr:sport:5",
    sportName: "Tennis",
    sportColor: "#EAB308",
    tournamentId: "sr:tournament:2472",
    tournamentName: "Test Open",
    categoryName: "Testland",
    countryCode: "TST",
    event_status: "Live",
    scheduledTime: "Wed Sep 16 09:30:00 UTC 2026",
    producerId: "1",
    producerStatus: "connected",
    activeBetCount: 0,
  });
});

test("GET /live-matches: sportId is kept unchanged, sportName/sportColor are null for an unmapped sport", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const match = body.matches.find((m: any) => m.matchId === unmappedSportMatch.matchId);
  assert.ok(match);
  assert.equal(match.sportId, "sr:sport:999999", "sportId must never be removed or replaced");
  assert.equal(match.sportName, null);
  assert.equal(match.sportColor, null);
});

test("GET /live-matches: sportName/sportColor are populated for all four mapped sports", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const expectations: Array<[MatchState, string, string]> = [
    [tableTennisMatch, "Table Tennis", "#06B6D4"],
    [cricketMatch, "Cricket", "#22C55E"],
    [liveMatch, "Tennis", "#EAB308"],
    [notStartedMatch, "Football", "#F97316"],
  ];

  for (const [fixture, expectedName, expectedColor] of expectations) {
    const match = body.matches.find((m: any) => m.matchId === fixture.matchId);
    assert.ok(match, `expected ${fixture.matchId} to appear`);
    assert.equal(match.sportId, fixture.sportId);
    assert.equal(match.sportName, expectedName, `${fixture.matchId} (${fixture.sportId}) sportName`);
    assert.equal(match.sportColor, expectedColor, `${fixture.matchId} (${fixture.sportId}) sportColor`);
  }

  // Same guarantee as sport-mapping.test.ts, but confirmed end-to-end
  // through the actual response: no two mapped sports share a color.
  const colors = expectations.map(([, , color]) => color);
  assert.equal(colors.length, new Set(colors).size);
});

test("GET /live-matches: a match with zero real bets shows activeBetCount: 0, not null/undefined", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const match = body.matches.find((m: any) => m.matchId === notStartedMatch.matchId);
  assert.ok(match);
  assert.equal(match.activeBetCount, 0);
  assert.equal(typeof match.activeBetCount, "number");
});

// This bet was genuinely open when placed (2026-09-17T05:40:50Z), but
// settled ~8.5 minutes later (a real sportsbook.bet_settled arrived at
// 2026-09-17T05:49:18Z, status "lost") while this endpoint was being
// built. So real-world state has since moved past "active" -- this test
// now demonstrates the settled-exclusion working correctly against real
// data, not the "still open" case the bet started as.
test("GET /live-matches: activeBetCount correctly excludes our real bet on sr:match:73842246 now that it has settled", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const match = body.matches.find((m: any) => m.matchId === realBetTestMatch.matchId);
  assert.ok(match, "expected the real test match to appear");
  assert.equal(
    match.activeBetCount,
    0,
    "bet _id 6aab7d62a41d15d89eb25bd5 settled (lost) at 2026-09-17T05:49:18Z and must no longer count as active"
  );
});

test("GET /live-matches: producerStatus is 'disconnected' for a match tied to a producer that reported connection:false", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const match = body.matches.find((m: any) => m.matchId === notStartedMatch.matchId);
  assert.ok(match);
  assert.equal(match.producerId, "2");
  assert.equal(match.producerStatus, "disconnected");
});

test("GET /live-matches: producerStatus is 'unconfirmed' when no producerId was ever captured for the match", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const match = body.matches.find((m: any) => m.matchId === unknownProducerMatch.matchId);
  assert.ok(match);
  assert.equal(match.producerId, undefined);
  assert.equal(match.producerStatus, "unconfirmed");
});

test("GET /live-matches: producerStatus is 'unconfirmed' (not 'disconnected') when the producerId is known but feed_status has never arrived for it", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  const match = body.matches.find((m: any) => m.matchId === neverReportedProducerMatch.matchId);
  assert.ok(match);
  assert.equal(match.producerId, "4");
  assert.equal(match.producerStatus, "unconfirmed", "never having received feed_status must read differently than a confirmed disconnect");
});

test("GET /live-matches?status=Live: only returns matches with that event_status", async () => {
  const res = await fetch(`${baseUrl}/live-matches?status=Live`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const matchIds = body.matches.map((m: any) => m.matchId);

  assert.ok(matchIds.includes(liveMatch.matchId));
  assert.ok(!matchIds.includes(notStartedMatch.matchId));
});

test("GET /live-matches?tournamentId=...: only returns matches in that tournament", async () => {
  const res = await fetch(`${baseUrl}/live-matches?tournamentId=sr:tournament:2472`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const matchIds = body.matches.map((m: any) => m.matchId);

  assert.ok(matchIds.includes(liveMatch.matchId));
  assert.ok(!matchIds.includes(notStartedMatch.matchId));
});

test("GET /live-matches?status=...&tournamentId=...: filters combine (AND)", async () => {
  const res = await fetch(`${baseUrl}/live-matches?status=NotStarted&tournamentId=sr:tournament:2472`);
  assert.equal(res.status, 200);
  const body = await res.json();

  // liveMatch matches tournamentId but not status; notStartedMatch matches
  // status but not tournamentId -- neither should appear.
  assert.equal(body.matches.length, 0);
});

test("GET /live-matches: feedHealth.connected is false when the feed was never started (no live socket in this test)", async () => {
  const res = await fetch(`${baseUrl}/live-matches`);
  const body = await res.json();

  assert.equal(body.feedHealth.connected, false);
});

test("GET /live-matches: feedHealth.producers reflects feedStatusStore contents", async () => {
  // "99" rather than "1"/"2" -- those are already used by the producerId
  // fixtures seeded in before(), and clobbering them here would break
  // whichever of those tests happens to run after this one.
  feedStatusStore.set("99", { raw: { producer_id: 99, status: "up" }, receivedAt: 123 });
  try {
    const res = await fetch(`${baseUrl}/live-matches`);
    const body = await res.json();
    assert.deepEqual(body.feedHealth.producers["99"], { raw: { producer_id: 99, status: "up" }, receivedAt: 123 });
  } finally {
    feedStatusStore.delete("99");
  }
});
