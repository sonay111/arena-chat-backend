import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMatchStatus, normalizeCrmMatch, computeProducerStatus } from "./crm-live-matches.js";
import type { CrmLiveMatch } from "../crm/types.js";

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

test("normalizeMatchStatus: 'not_started' (snake_case, real cricket example) normalizes to 'NotStarted'", () => {
  assert.equal(normalizeMatchStatus("not_started"), "NotStarted");
});

test("normalizeMatchStatus: 'NotStarted' (PascalCase, real tennis example, same live call) also normalizes to 'NotStarted'", () => {
  assert.equal(normalizeMatchStatus("NotStarted"), "NotStarted");
});

test("normalizeMatchStatus: 'Live' and 'Suspended' pass through as our canonical values", () => {
  assert.equal(normalizeMatchStatus("Live"), "Live");
  assert.equal(normalizeMatchStatus("Suspended"), "Suspended");
});

test("normalizeMatchStatus: an unrecognized value passes through as-is rather than being hidden (e.g. real 'Interrupted' example)", () => {
  assert.equal(normalizeMatchStatus("Interrupted"), "Interrupted");
});

test("normalizeCrmMatch: combines team1Name + team2Name into 'name'", () => {
  const result = normalizeCrmMatch(match({ team1Name: "Uzbekistan", team2Name: "China PR" }));
  assert.equal(result.name, "Uzbekistan vs. China PR");
});

test("normalizeCrmMatch: uses the CRM's own sportId directly, no more reverse-derivation from sportName", () => {
  const result = normalizeCrmMatch(match({ sportId: "sr:sport:1", sportName: "Soccer" }));
  assert.equal(result.sportId, "sr:sport:1");
  assert.equal(result.sportColor, "#F97316");
  assert.equal(result.sportName, "Soccer", "sportName still passes through the CRM's own raw value");
});

test("normalizeCrmMatch: an sportId we don't have a color mapping for gets sportColor null, sportId/sportName still pass through", () => {
  const result = normalizeCrmMatch(match({ sportId: "sr:sport:999", sportName: "Basketball" }));
  assert.equal(result.sportId, "sr:sport:999", "sportId always passes through now -- it's real data, not a guess");
  assert.equal(result.sportColor, null);
  assert.equal(result.sportName, "Basketball");
});

test("normalizeCrmMatch: tournamentId and countryCode are always null (CRM never provides them)", () => {
  const result = normalizeCrmMatch(match());
  assert.equal(result.tournamentId, null);
  assert.equal(result.countryCode, null);
});

test("normalizeCrmMatch: region maps to categoryName, including a real null-region example", () => {
  assert.equal(normalizeCrmMatch(match({ region: "Czech Republic" })).categoryName, "Czech Republic");
  assert.equal(normalizeCrmMatch(match({ region: null })).categoryName, null);
});

test("normalizeCrmMatch: updatedAt is parsed to epoch ms for staleness comparison", () => {
  const result = normalizeCrmMatch(match({ updatedAt: "2026-09-18T05:02:00.000Z" }));
  assert.equal(result.lastUpdatedAtMs, new Date("2026-09-18T05:02:00.000Z").getTime());
});

test("normalizeCrmMatch: isSimulated is true when region is exactly 'Simulated Reality League'", () => {
  const result = normalizeCrmMatch(
    match({ region: "Simulated Reality League", team1Name: "Zhejiang Professional Srl", team2Name: "Wuhan Three Towns FC Srl" })
  );
  assert.equal(result.isSimulated, true);
});

test("normalizeCrmMatch: isSimulated is false for a real region, even one with 'SRL' in team/tournament names", () => {
  // Not a real observed combination, but confirms this is a region match,
  // not a "contains SRL" text search against team/tournament names.
  const result = normalizeCrmMatch(match({ region: "Czech Republic", team1Name: "Team SRL A", team2Name: "Team B" }));
  assert.equal(result.isSimulated, false);
});

test("normalizeCrmMatch: isSimulated is false when region is null", () => {
  const result = normalizeCrmMatch(match({ region: null }));
  assert.equal(result.isSimulated, false);
});

test("normalizeCrmMatch: hasOdds passes through directly, including the real false case", () => {
  assert.equal(normalizeCrmMatch(match({ hasOdds: true })).hasOdds, true);
  assert.equal(normalizeCrmMatch(match({ hasOdds: false, producerId: null, connection: null })).hasOdds, false);
});

test("normalizeCrmMatch: producerStatus is derived from this match's own producerId/connection", () => {
  assert.equal(normalizeCrmMatch(match({ producerId: 1, connection: true })).producerStatus, "connected");
  assert.equal(normalizeCrmMatch(match({ producerId: 1, connection: false })).producerStatus, "disconnected");
  assert.equal(normalizeCrmMatch(match({ producerId: null, connection: null })).producerStatus, "unconfirmed");
});

test("computeProducerStatus: 'connected' when connection is true", () => {
  assert.equal(computeProducerStatus(1, true), "connected");
});

test("computeProducerStatus: 'disconnected' when connection is false", () => {
  assert.equal(computeProducerStatus(1, false), "disconnected");
});

test("computeProducerStatus: 'unconfirmed' when producerId and connection are both null (real example: hasOdds: false matches)", () => {
  assert.equal(computeProducerStatus(null, null), "unconfirmed");
});

test("computeProducerStatus: 'unconfirmed' on an inconsistent combination too (defensive, not observed live)", () => {
  assert.equal(computeProducerStatus(null, true), "unconfirmed");
  assert.equal(computeProducerStatus(1, null), "unconfirmed");
});
