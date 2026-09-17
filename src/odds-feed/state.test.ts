import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMatchMessage, getMatchId, getProducerKey, applyFeedStatus } from "./state.js";
import type { MatchState } from "./state.js";

// Real payload shapes captured live 2026-09-16 — trimmed to the fields
// state.ts actually reads (markets/outcomes are deliberately discarded by
// applyMatchMessage, so tests don't need them either).
const oddsPayload = (overrides: Record<string, unknown> = {}) => ({
  name: "Siniakov, Daniel vs. Schneider, Vaclav",
  id: "sr:match:74597748",
  sportId: "sr:sport:5",
  scheduledTime: "Wed Sep 16 09:30:00 UTC 2026",
  event_status: "Live",
  tournamentId: "sr:tournament:36349",
  tournamentName: "Czech Liga Pro",
  categoryName: "Czech Republic",
  countryCode: "CZE",
  timestamp: 1789558921419,
  producer_id: 1,
  ...overrides,
});

test("odds: creates new match state with metadata, discards markets/outcomes", () => {
  const payload = { ...oddsPayload(), markets: [{ some: "huge market data" }] };
  const matchId = getMatchId(payload)!;
  const result = applyMatchMessage(undefined, matchId, "odds", payload);

  assert.equal(result.applied, true);
  assert.equal(result.state.matchId, "sr:match:74597748");
  assert.equal(result.state.name, "Siniakov, Daniel vs. Schneider, Vaclav");
  assert.equal(result.state.sportId, "sr:sport:5");
  assert.equal(result.state.tournamentId, "sr:tournament:36349");
  assert.equal(result.state.tournamentName, "Czech Liga Pro");
  assert.equal(result.state.categoryName, "Czech Republic");
  assert.equal(result.state.countryCode, "CZE");
  assert.equal(result.state.producerId, "1");
  assert.equal(result.state.eventStatus, "Live");
  assert.equal(result.state.scheduledTime, "Wed Sep 16 09:30:00 UTC 2026");
  assert.equal(result.state.lastTimestamp, 1789558921419);
  assert.equal((result.state as any).markets, undefined, "markets must not be carried into state");
});

test("match_status: updates eventStatus on existing state, leaves other fields untouched", () => {
  const current: MatchState = {
    matchId: "sr:match:69456610",
    name: "Some Match",
    eventStatus: "Live",
    lastTimestamp: 1000,
    producerId: "1",
  };
  const payload = { matchId: "sr:match:69456610", status: "Suspended", _seq: 193054 };
  const result = applyMatchMessage(current, "sr:match:69456610", "match_status", payload);

  assert.equal(result.applied, true);
  assert.equal(result.state.eventStatus, "Suspended");
  assert.equal(result.state.name, "Some Match", "unrelated fields should be preserved");
  assert.equal(result.state.producerId, "1", "producerId should be preserved (match_status doesn't carry it)");
});

test("bet_stop: marks bettingStopped without touching eventStatus", () => {
  const current: MatchState = { matchId: "sr:match:74733100", eventStatus: "Live" };
  const payload = { matchId: "sr:match:74733100", _seq: 193029 };
  const result = applyMatchMessage(current, "sr:match:74733100", "bet_stop", payload);

  assert.equal(result.applied, true);
  assert.equal(result.state.bettingStopped, true);
  assert.equal(result.state.eventStatus, "Live");
});

test("ended_match: marks ended and updates status if present", () => {
  const current: MatchState = { matchId: "sr:match:1", eventStatus: "Live" };
  const payload = { matchId: "sr:match:1", status: "Ended" };
  const result = applyMatchMessage(current, "sr:match:1", "ended_match", payload);

  assert.equal(result.applied, true);
  assert.equal(result.state.ended, true);
  assert.equal(result.state.eventStatus, "Ended");
});

test("stale timestamp: an odds message older than the last applied timestamp is rejected", () => {
  const current: MatchState = { matchId: "sr:match:1", eventStatus: "Live", lastTimestamp: 2000 };
  const payload = oddsPayload({ id: "sr:match:1", event_status: "Suspended", timestamp: 1000 });
  const result = applyMatchMessage(current, "sr:match:1", "odds", payload);

  assert.equal(result.applied, false);
  assert.equal(result.state, current, "rejected message must leave existing state untouched");
  assert.equal(result.state.eventStatus, "Live", "the stale Suspended status must not have been applied");
});

test("equal timestamp is accepted (not strictly older)", () => {
  const current: MatchState = { matchId: "sr:match:1", eventStatus: "Live", lastTimestamp: 2000 };
  const payload = oddsPayload({ id: "sr:match:1", event_status: "Suspended", timestamp: 2000 });
  const result = applyMatchMessage(current, "sr:match:1", "odds", payload);

  assert.equal(result.applied, true);
  assert.equal(result.state.eventStatus, "Suspended");
});

test("a message with no timestamp at all is always applied, even after a timestamped one", () => {
  const current: MatchState = { matchId: "sr:match:1", eventStatus: "Live", lastTimestamp: 999999999 };
  const payload = { matchId: "sr:match:1", status: "Suspended", _seq: 1 };
  const result = applyMatchMessage(current, "sr:match:1", "match_status", payload);

  assert.equal(result.applied, true);
  assert.equal(result.state.eventStatus, "Suspended");
  // lastTimestamp is untouched since this message carried none.
  assert.equal(result.state.lastTimestamp, 999999999);
});

test("first message ever for a match (no prior state) is always applied regardless of timestamp", () => {
  const payload = oddsPayload({ id: "sr:match:new", timestamp: 1 });
  const result = applyMatchMessage(undefined, "sr:match:new", "odds", payload);

  assert.equal(result.applied, true);
  assert.equal(result.state.matchId, "sr:match:new");
});

test("getMatchId: odds payloads use 'id', match_status/bet_stop use 'matchId'", () => {
  assert.equal(getMatchId({ id: "sr:match:1" }), "sr:match:1");
  assert.equal(getMatchId({ matchId: "sr:match:2" }), "sr:match:2");
  assert.equal(getMatchId({}), undefined);
});

test("feed_status: keyed by producer_id, falls back to 'default' when absent", () => {
  assert.equal(getProducerKey({ producer_id: 1 }), "1");
  assert.equal(getProducerKey({}), "default");

  const status = applyFeedStatus({ producer_id: 1, status: "up" });
  assert.deepEqual(status.raw, { producer_id: 1, status: "up" });
  assert.ok(typeof status.receivedAt === "number");
});
