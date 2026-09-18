import { test } from "node:test";
import assert from "node:assert/strict";
import { computeActiveBetCounts, computeActiveStakeByCurrency } from "./active-bets.js";
import type { RawBetPlacedRow } from "./active-bets.js";

function row(overrides: Partial<RawBetPlacedRow> = {}): RawBetPlacedRow {
  return {
    betId: "bet1",
    status: "open",
    legs: [{ odds: 1.5, matchId: "sr:match:1" }],
    stake: 10,
    currency: "INR",
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

test("computeActiveStakeByCurrency: a single active bet's stake is grouped under its currency", () => {
  const sums = computeActiveStakeByCurrency([row({ stake: 10, currency: "INR" })], new Set());
  assert.deepEqual(sums.get("sr:match:1"), { INR: 10 });
});

test("computeActiveStakeByCurrency: two bets in DIFFERENT currencies on the same match are kept separate, not summed together", () => {
  const bets = [
    row({ betId: "bet1", stake: 2, currency: "USDT" }),
    row({ betId: "bet2", stake: 500, currency: "INR" }),
  ];
  const sums = computeActiveStakeByCurrency(bets, new Set());
  assert.deepEqual(sums.get("sr:match:1"), { USDT: 2, INR: 500 });
});

test("computeActiveStakeByCurrency: two bets in the SAME currency on the same match are summed", () => {
  const bets = [
    row({ betId: "bet1", stake: 10, currency: "INR" }),
    row({ betId: "bet2", stake: 25, currency: "INR" }),
  ];
  const sums = computeActiveStakeByCurrency(bets, new Set());
  assert.deepEqual(sums.get("sr:match:1"), { INR: 35 });
});

test("computeActiveStakeByCurrency: a multi-leg bet contributes its full stake to EACH match it applies to, not split between them", () => {
  const bet = row({
    betId: "bet1",
    stake: 10,
    currency: "USDT",
    legs: [
      { odds: 1.2, matchId: "sr:match:A" },
      { odds: 1.3, matchId: "sr:match:B" },
    ],
  });
  const sums = computeActiveStakeByCurrency([bet], new Set());
  assert.deepEqual(sums.get("sr:match:A"), { USDT: 10 });
  assert.deepEqual(sums.get("sr:match:B"), { USDT: 10 });
});

test("computeActiveStakeByCurrency: a settled bet does not contribute, same as computeActiveBetCounts", () => {
  const sums = computeActiveStakeByCurrency([row({ betId: "bet1" })], new Set(["bet1"]));
  assert.equal(sums.get("sr:match:1"), undefined);
});

test("computeActiveStakeByCurrency: a match with no active bets has no entry at all", () => {
  const sums = computeActiveStakeByCurrency([], new Set());
  assert.equal(sums.size, 0);
});
