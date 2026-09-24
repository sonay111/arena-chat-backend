import { test } from "node:test";
import assert from "node:assert/strict";
import { toOverdueSettlementBets, summarizeOverdueByMatch } from "./detect.js";
import type { SportsbookBet } from "../crm/index.js";

// Real example from the live QA call confirmed 2026-09-24 against
// /crm/all-unsettled-bets -- this is now the authoritative source, so
// every bet it returns is already confirmed overdue with no threshold
// math left for us to do.
function unsettledBet(overrides: Partial<SportsbookBet> = {}): SportsbookBet {
  return {
    _id: "some_bet_id",
    userId: "some_user_id",
    stakeAmount: 100,
    returnAmount: 0,
    winLossAmount: 0,
    eventMarketInformation: { matchId: "sr:match:1" },
    betDateTime: "2026-08-27T07:14:38.815Z",
    status: "pending",
    ...overrides,
  } as SportsbookBet;
}

test("toOverdueSettlementBets: the real all-unsettled-bets example (6a8fe3de933517fed4fbf3a0) maps through unchanged", () => {
  const bet = unsettledBet({
    _id: "6a8fe3de933517fed4fbf3a0",
    userId: "6a8e9b7f2ae5ea6dac1ce929",
    stakeAmount: 3,
    eventMarketInformation: {
      matchId: "sr:match:73285234",
      marketId: "363",
      marketName: "1st innings over 1 - 1st delivery Melbourne Renegades SRL total",
      betTitle: "over 0.5",
      teamName: "over 0.5",
      tournamentName: "Brisbane Heat SRL vs Melbourne Renegades SRL",
      sportsType: "sr:sport:21",
    },
    betDateTime: "2026-08-27T07:14:38.815Z",
  });

  const overdue = toOverdueSettlementBets([bet]);
  assert.equal(overdue.length, 1);
  assert.deepEqual(overdue[0], {
    betId: "6a8fe3de933517fed4fbf3a0",
    userId: "6a8e9b7f2ae5ea6dac1ce929",
    matchId: "sr:match:73285234",
    stakeAmount: 3,
    betDateTime: "2026-08-27T07:14:38.815Z",
    reason: "confirmed_unsettled_by_platform",
    minutesSinceMatchEnded: null,
  });
});

// Real second example from the same live call.
test("toOverdueSettlementBets: the real second example (6a146647d4c280c6b65205e2) maps through too", () => {
  const bet = unsettledBet({
    _id: "6a146647d4c280c6b65205e2",
    userId: "6a1465c44f20d11059ee424b",
    stakeAmount: 5,
    eventMarketInformation: { matchId: "sr:match:71501210", sportsType: "sports" },
    betDateTime: "2026-05-25T15:09:59.598Z",
  });

  const overdue = toOverdueSettlementBets([bet]);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].betId, "6a146647d4c280c6b65205e2");
  assert.equal(overdue[0].matchId, "sr:match:71501210");
});

test("toOverdueSettlementBets: a bet with no matchId at all is skipped, not guessed at", () => {
  const bet = unsettledBet({ eventMarketInformation: {} });
  const overdue = toOverdueSettlementBets([bet]);
  assert.equal(overdue.length, 0);
});

test("toOverdueSettlementBets: an empty list in -> an empty list out (no unsettled bets right now)", () => {
  assert.deepEqual(toOverdueSettlementBets([]), []);
});

test("summarizeOverdueByMatch: groups multiple overdue bets on the same match into one summary", () => {
  const bets = [
    unsettledBet({ _id: "b1", stakeAmount: 3, eventMarketInformation: { matchId: "sr:match:73285234" } }),
    unsettledBet({ _id: "b2", stakeAmount: 200, eventMarketInformation: { matchId: "sr:match:73285234" } }),
  ];
  const overdue = toOverdueSettlementBets(bets);
  const byMatch = summarizeOverdueByMatch(overdue);

  assert.equal(byMatch.length, 1);
  assert.equal(byMatch[0].matchId, "sr:match:73285234");
  assert.equal(byMatch[0].overdueBetCount, 2);
  assert.equal(byMatch[0].totalOverdueStake, 203);
});

test("summarizeOverdueByMatch: distinct matches get separate summaries", () => {
  const bets = [
    unsettledBet({ _id: "b1", stakeAmount: 3, eventMarketInformation: { matchId: "sr:match:73285234" } }),
    unsettledBet({ _id: "b2", stakeAmount: 5, eventMarketInformation: { matchId: "sr:match:71501210" } }),
  ];
  const overdue = toOverdueSettlementBets(bets);
  const byMatch = summarizeOverdueByMatch(overdue);

  assert.equal(byMatch.length, 2);
});

test("summarizeOverdueByMatch: no overdue bets -> empty summary, not an error", () => {
  assert.deepEqual(summarizeOverdueByMatch([]), []);
});
