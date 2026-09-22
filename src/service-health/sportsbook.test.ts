import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSportsbookHealth } from "./sportsbook.js";
import type { CrmLiveMatch } from "../crm/types.js";
import type { NormalizedLeaf } from "./types.js";

function match(overrides: Partial<CrmLiveMatch> = {}): CrmLiveMatch {
  return {
    matchId: "sr:match:1",
    sportId: "sr:sport:1",
    status: "Live",
    sportName: "Soccer",
    team1Name: "Team A",
    team2Name: "Team B",
    tournamentName: "Test League",
    region: "Testland",
    startTime: "2026-09-18T05:00:00.000Z",
    updatedAt: "2026-09-18T05:02:00.000Z",
    producerId: 1,
    connection: true,
    hasOdds: true,
    ...overrides,
  };
}

test("computeSportsbookHealth: connected + all matches producer-connected -> ok", async () => {
  const result = await computeSportsbookHealth(
    async () => ({ matches: [match({ producerId: 1, connection: true })], totalData: 1 }),
    () => true
  );
  assert.equal(result.key, "sportsbook");
  assert.equal(result.status, "ok");
  assert.equal(result.realCoverage, "full");
  assert.equal(result.checks.find((c) => c.key === "odds_feed_connection")?.status, "ok");
  assert.equal(result.checks.find((c) => c.key === "producer_status")?.status, "ok");
});

test("computeSportsbookHealth: our own connection down -> category status down, regardless of producer signal", async () => {
  const result = await computeSportsbookHealth(
    async () => ({ matches: [match({ producerId: 1, connection: true })], totalData: 1 }),
    () => false
  );
  assert.equal(result.checks.find((c) => c.key === "odds_feed_connection")?.status, "down");
  assert.equal(result.status, "down");
});

test("computeSportsbookHealth: connection ok but a live match's producer is disconnected -> down", async () => {
  const result = await computeSportsbookHealth(
    async () => ({ matches: [match({ producerId: 1, connection: false })], totalData: 1 }),
    () => true
  );
  assert.equal(result.checks.find((c) => c.key === "producer_status")?.status, "down");
  assert.equal(result.status, "down");
});

test("computeSportsbookHealth: no live matches right now -> producer status unknown, not ok or down", async () => {
  const result = await computeSportsbookHealth(async () => ({ matches: [], totalData: 0 }), () => true);
  assert.equal(result.checks.find((c) => c.key === "producer_status")?.status, "unknown");
  assert.equal(result.status, "ok", "connection ok + unknown producer signal aggregates to ok, same worst-of-children rule as everywhere else");
});

test("computeSportsbookHealth: unconfirmed producerStatus (real hasOdds:false shape) contributes unknown, not down", async () => {
  const result = await computeSportsbookHealth(
    async () => ({
      matches: [match({ producerId: null, connection: null, hasOdds: false }), match({ matchId: "sr:match:2", producerId: 1, connection: true })],
      totalData: 2,
    }),
    () => true
  );
  assert.equal(result.checks.find((c) => c.key === "producer_status")?.status, "ok", "one real connected match outweighs one unconfirmed match, same aggregateStatus rule");
});

test("computeSportsbookHealth: the CRM live-matches call failing surfaces as unknown, not a thrown error", async () => {
  const result = await computeSportsbookHealth(async () => {
    throw new Error("CRM unreachable");
  }, () => true);
  const producer = result.checks.find((c) => c.key === "producer_status") as NormalizedLeaf;
  assert.equal(producer?.status, "unknown");
  assert.equal(producer?.lastError, "CRM unreachable");
});
