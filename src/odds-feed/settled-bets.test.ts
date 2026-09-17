import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSettledBetCounts } from "./settled-bets.js";
import type { RawBetSettledRow } from "./settled-bets.js";

function row(overrides: Partial<RawBetSettledRow> = {}): RawBetSettledRow {
  return {
    betId: "bet1",
    status: "won",
    matchId: "sr:match:1",
    receivedAt: new Date("2026-09-17T00:00:00.000Z"),
    ...overrides,
  };
}

test("a won bet increments won only", () => {
  const counts = computeSettledBetCounts([row({ status: "won" })]);
  assert.deepEqual(counts.get("sr:match:1"), { won: 1, lost: 0, void: 0 });
});

test("a lost bet increments lost only", () => {
  const counts = computeSettledBetCounts([row({ betId: "bet2", status: "lost" })]);
  assert.deepEqual(counts.get("sr:match:1"), { won: 0, lost: 1, void: 0 });
});

test("void and cashed_out both increment the void bucket, not won/lost, and aren't dropped", () => {
  const counts = computeSettledBetCounts([
    row({ betId: "bet3", status: "void" }),
    row({ betId: "bet4", status: "cashed_out" }),
  ]);
  assert.deepEqual(counts.get("sr:match:1"), { won: 0, lost: 0, void: 2 });
});

test("multiple settled bets on the same match accumulate correctly across all three buckets", () => {
  const rows = [
    row({ betId: "bet1", status: "won" }),
    row({ betId: "bet2", status: "won" }),
    row({ betId: "bet3", status: "lost" }),
    row({ betId: "bet4", status: "void" }),
  ];
  const counts = computeSettledBetCounts(rows);
  assert.deepEqual(counts.get("sr:match:1"), { won: 2, lost: 1, void: 1 });
});

test("raw_webhook_events is append-only, so a bet_id can settle more than once (confirmed live) -- the most recent row wins", () => {
  const olderWon = row({ betId: "bet5", status: "won", receivedAt: new Date("2026-09-17T00:00:00.000Z") });
  const newerLost = row({ betId: "bet5", status: "lost", receivedAt: new Date("2026-09-17T00:05:00.000Z") });
  const counts = computeSettledBetCounts([olderWon, newerLost]);
  assert.deepEqual(counts.get("sr:match:1"), { won: 0, lost: 1, void: 0 }, "the later 'lost' status must win over the earlier 'won' one");
});

test("a match with no settled bets at all has no entry in the returned map", () => {
  const counts = computeSettledBetCounts([]);
  assert.equal(counts.get("sr:match:nonexistent"), undefined);
  assert.equal(counts.size, 0);
});

test("a row with no matchId is ignored", () => {
  const counts = computeSettledBetCounts([row({ betId: "bet6", matchId: null })]);
  assert.equal(counts.size, 0);
});
