import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMatchBetHistory } from "./match-bet-history.js";
import type { RawPlacedRow, RawSettledRow } from "./match-bet-history.js";

function placedRow(overrides: Partial<RawPlacedRow> = {}): RawPlacedRow {
  return {
    betId: "bet1",
    userId: "player1",
    status: "open",
    odds: 1.5,
    stake: 10,
    marketName: "Match Winner",
    betDateTime: "2026-09-17T00:00:00.000Z",
    legs: [{ odds: 1.5, matchId: "sr:match:1" }],
    receivedAt: new Date("2026-09-17T00:00:00.000Z"),
    ...overrides,
  };
}

function settledRow(overrides: Partial<RawSettledRow> = {}): RawSettledRow {
  return {
    betId: "bet1",
    userId: "player1",
    status: "won",
    stake: 10,
    marketName: "Match Winner",
    betDateTime: "2026-09-17T00:00:00.000Z",
    receivedAt: new Date("2026-09-17T00:05:00.000Z"),
    ...overrides,
  };
}

test("an open bet on this match appears in openBets with all fields", () => {
  const history = computeMatchBetHistory("sr:match:1", [placedRow()], []);
  assert.equal(history.openBets.length, 1);
  assert.deepEqual(history.openBets[0], {
    betId: "bet1",
    playerId: "player1",
    stake: 10,
    odds: 1.5,
    marketName: "Match Winner",
    status: "open",
    timestamp: "2026-09-17T00:00:00.000Z",
  });
  assert.equal(history.settledBets.length, 0);
});

test("a bet whose legs don't include this match is excluded entirely", () => {
  const history = computeMatchBetHistory("sr:match:999", [placedRow()], []);
  assert.equal(history.openBets.length, 0);
  assert.equal(history.settledBets.length, 0);
});

test("a settled bet appears in settledBets, sourcing odds from the original bet_placed row", () => {
  const history = computeMatchBetHistory("sr:match:1", [placedRow()], [settledRow()]);
  assert.equal(history.openBets.length, 0, "a settled bet must not also appear as open");
  assert.equal(history.settledBets.length, 1);
  assert.deepEqual(history.settledBets[0], {
    betId: "bet1",
    playerId: "player1",
    stake: 10,
    odds: 1.5, // sourced from the placed row -- bet_settled never carries odds
    marketName: "Match Winner",
    status: "won",
    timestamp: "2026-09-17T00:00:00.000Z",
  });
});

test("a settled bet with no corresponding bet_placed row still appears, with odds: null", () => {
  const history = computeMatchBetHistory("sr:match:1", [], [settledRow({ betId: "bet2" })]);
  assert.equal(history.settledBets.length, 1);
  assert.equal(history.settledBets[0].odds, null);
  assert.equal(history.settledBets[0].status, "won");
});

test("a bet_placed row with status other than 'open' and no settlement doesn't appear in either list", () => {
  const history = computeMatchBetHistory("sr:match:1", [placedRow({ status: "cancelled" })], []);
  assert.equal(history.openBets.length, 0);
  assert.equal(history.settledBets.length, 0);
});

test("append-only duplicates: the most recent bet_placed row wins for open-bet fields", () => {
  const older = placedRow({ odds: 1.5, receivedAt: new Date("2026-09-17T00:00:00.000Z") });
  const newer = placedRow({ odds: 1.8, receivedAt: new Date("2026-09-17T00:01:00.000Z") });
  const history = computeMatchBetHistory("sr:match:1", [older, newer], []);
  assert.equal(history.openBets[0].odds, 1.8);
});

test("append-only duplicates: the most recent bet_settled row wins (e.g. a correction)", () => {
  const olderWon = settledRow({ status: "won", receivedAt: new Date("2026-09-17T00:05:00.000Z") });
  const newerVoid = settledRow({ status: "void", receivedAt: new Date("2026-09-17T00:10:00.000Z") });
  const history = computeMatchBetHistory("sr:match:1", [placedRow()], [olderWon, newerVoid]);
  assert.equal(history.settledBets[0].status, "void");
});

test("a match with no real bets at all returns empty arrays, not an error", () => {
  const history = computeMatchBetHistory("sr:match:nonexistent", [], []);
  assert.deepEqual(history, { openBets: [], settledBets: [] });
});
