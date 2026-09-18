import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMatchStatus, normalizeCrmMatch, computeFeedStatus } from "./crm-live-matches.js";
import type { CrmLiveMatch } from "../crm/types.js";

function match(overrides: Partial<CrmLiveMatch> = {}): CrmLiveMatch {
  return {
    matchId: "sr:match:1",
    status: "Live",
    sportName: "Soccer",
    team1Name: "Team A",
    team2Name: "Team B",
    tournamentName: "Test League",
    region: "Testland",
    startTime: "2026-09-18T05:00:00.000Z",
    updatedAt: "2026-09-18T05:02:00.000Z",
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

test("normalizeMatchStatus: an unrecognized value passes through as-is rather than being hidden", () => {
  assert.equal(normalizeMatchStatus("Postponed"), "Postponed");
});

test("normalizeCrmMatch: combines team1Name + team2Name into 'name'", () => {
  const result = normalizeCrmMatch(match({ team1Name: "Uzbekistan", team2Name: "China PR" }));
  assert.equal(result.name, "Uzbekistan vs. China PR");
});

test("normalizeCrmMatch: 'Soccer' resolves to sr:sport:1 (our SPORT_MAPPING calls it Football)", () => {
  const result = normalizeCrmMatch(match({ sportName: "Soccer" }));
  assert.equal(result.sportId, "sr:sport:1");
  assert.equal(result.sportColor, "#F97316");
  assert.equal(result.sportName, "Soccer", "sportName stays the CRM's own raw value");
});

test("normalizeCrmMatch: 'Table Tennis', 'Cricket', 'Tennis' resolve directly (no synonym needed)", () => {
  assert.equal(normalizeCrmMatch(match({ sportName: "Table Tennis" })).sportId, "sr:sport:20");
  assert.equal(normalizeCrmMatch(match({ sportName: "Cricket" })).sportId, "sr:sport:21");
  assert.equal(normalizeCrmMatch(match({ sportName: "Tennis" })).sportId, "sr:sport:5");
});

test("normalizeCrmMatch: an unmapped sport has sportId/sportColor null, sportName passes through raw", () => {
  const result = normalizeCrmMatch(match({ sportName: "Basketball" }));
  assert.equal(result.sportId, null);
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

test("computeFeedStatus: 'connected' when every producer reports true", () => {
  assert.equal(computeFeedStatus({ "1": true, "3": true }), "connected");
});

test("computeFeedStatus: 'disconnected' when every producer reports false", () => {
  assert.equal(computeFeedStatus({ "1": false, "3": false }), "disconnected");
});

test("computeFeedStatus: 'degraded' (not 'unconfirmed') on a real mixed result -- some producers up, some down", () => {
  assert.equal(computeFeedStatus({ "1": true, "3": false }), "degraded");
});

test("computeFeedStatus: 'unconfirmed' is reserved for genuinely no data -- feed missing or empty", () => {
  assert.equal(computeFeedStatus(undefined), "unconfirmed");
  assert.equal(computeFeedStatus({}), "unconfirmed");
});
