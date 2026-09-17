import { test } from "node:test";
import assert from "node:assert/strict";
import { computeActiveBetCounts } from "./active-bets.js";
import type { RawBetPlacedRow } from "./active-bets.js";

function row(overrides: Partial<RawBetPlacedRow> = {}): RawBetPlacedRow {
  return {
    betId: "bet1",
    status: "open",
    legs: [{ odds: 1.5, matchId: "sr:match:1" }],
    receivedAt: new Date("2026-09-17T00:00:00.000Z"),
    ...overrides,
  };
}

test("an open, unsettled single-leg bet counts once for its match", () => {
  const counts = computeActiveBetCounts([row()], new Set());
  assert.equal(counts.get("sr:match:1"), 1);
});

test("a multi-leg bet counts once for EACH distinct match, not just the first", () => {
  const bet = row({
    betId: "bet2",
    legs: [
      { odds: 1.2, matchId: "sr:match:A" },
      { odds: 1.3, matchId: "sr:match:B" },
    ],
  });
  const counts = computeActiveBetCounts([bet], new Set());
  assert.equal(counts.get("sr:match:A"), 1);
  assert.equal(counts.get("sr:match:B"), 1);
});

test("the same matchId appearing twice in one bet's legs only counts once for that bet", () => {
  const bet = row({
    betId: "bet3",
    legs: [
      { odds: 1.2, matchId: "sr:match:1" },
      { odds: 1.4, matchId: "sr:match:1" },
    ],
  });
  const counts = computeActiveBetCounts([bet], new Set());
  assert.equal(counts.get("sr:match:1"), 1);
});

test("two different bets on the same match both count", () => {
  const bets = [row({ betId: "bet1" }), row({ betId: "bet2" })];
  const counts = computeActiveBetCounts(bets, new Set());
  assert.equal(counts.get("sr:match:1"), 2);
});

test("a bet with status other than 'open' does not count", () => {
  const bet = row({ betId: "bet4", status: "void" });
  const counts = computeActiveBetCounts([bet], new Set());
  assert.equal(counts.get("sr:match:1"), undefined);
});

test("a bet already settled (its _id appears in settledBetIds) does not count, even if status still says open", () => {
  const bet = row({ betId: "bet5" });
  const counts = computeActiveBetCounts([bet], new Set(["bet5"]));
  assert.equal(counts.get("sr:match:1"), undefined);
});

test("raw_webhook_events is append-only, so a bet_id can have multiple rows -- the most recent (by receivedAt) wins", () => {
  const olderOpen = row({
    betId: "bet6",
    status: "open",
    receivedAt: new Date("2026-09-17T00:00:00.000Z"),
  });
  const newerVoided = row({
    betId: "bet6",
    status: "void",
    receivedAt: new Date("2026-09-17T00:05:00.000Z"),
  });
  const counts = computeActiveBetCounts([olderOpen, newerVoided], new Set());
  assert.equal(counts.get("sr:match:1"), undefined, "the later 'void' status must win over the earlier 'open' one");
});

test("a match with no bets at all simply has no entry in the returned map", () => {
  const counts = computeActiveBetCounts([], new Set());
  assert.equal(counts.get("sr:match:nonexistent"), undefined);
  assert.equal(counts.size, 0);
});
