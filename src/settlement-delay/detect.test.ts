import { test } from "node:test";
import assert from "node:assert/strict";
import { findOverdueSettlementBets, summarizeOverdueByMatch } from "./detect.js";
import type { CrmLiveMatch, SportsbookBet } from "../crm/index.js";

// Real fixtures captured live 2026-09-24 against the CRM's confirmed-real
// bet_status=pending filter (26 real pending bets) and live-matches feed.

function pendingBet(overrides: Partial<SportsbookBet> = {}): SportsbookBet {
  return {
    _id: "some_bet_id",
    userId: "some_user_id",
    stakeAmount: 100,
    returnAmount: 0,
    winLossAmount: 0,
    eventMarketInformation: { matchId: "sr:match:1" },
    betDateTime: "2026-09-22T00:00:00.000Z",
    status: "pending",
    ...overrides,
  } as SportsbookBet;
}

function liveMatch(overrides: Partial<CrmLiveMatch> = {}): CrmLiveMatch {
  return {
    matchId: "sr:match:1",
    sportId: "sr:sport:21",
    status: "Live",
    sportName: "Cricket",
    team1Name: "Team A",
    team2Name: "Team B",
    tournamentName: "Test Series",
    region: "International",
    startTime: "2026-09-22T04:00:00.000Z",
    updatedAt: "2026-09-24T07:21:22.877Z",
    producerId: 5,
    connection: true,
    hasOdds: true,
    ...overrides,
  };
}

// Real example: bet 6ab216808da72b1a3a675bc7 on sr:match:74559842, still
// genuinely Live right now (real live-matches snapshot, checkedAt
// 2026-09-24T07:2x). Not overdue -- the match hasn't ended.
test("findOverdueSettlementBets: a pending bet on a real still-Live match is NOT flagged", () => {
  const bet = pendingBet({
    _id: "6ab216808da72b1a3a675bc7",
    userId: "6a4257cf126678e77124ce98",
    stakeAmount: 200,
    eventMarketInformation: { matchId: "sr:match:74559842" },
    betDateTime: "2026-09-22T05:47:44.484Z",
  });
  const match = liveMatch({
    matchId: "sr:match:74559842",
    status: "Live",
    team1Name: "India A",
    team2Name: "Australia A",
    updatedAt: "2026-09-24T07:21:22.877Z",
  });
  const now = new Date("2026-09-24T07:30:00.000Z").getTime();

  const overdue = findOverdueSettlementBets([bet], [match], now);
  assert.equal(overdue.length, 0, "the match is still Live, not Ended -- nothing to flag");
});

// Real example: bet 6a9520d1c16e52500924b3ee on sr:match:73281486, one of
// the 14 real pending-bet matches confirmed absent from live-matches
// entirely (betDateTime shows it's 24+ days old -- unambiguously over).
test("findOverdueSettlementBets: a pending bet whose match is absent from the feed is flagged immediately, no 15-min wait", () => {
  const bet = pendingBet({
    _id: "6a9520d1c16e52500924b3ee",
    userId: "6a8c4143fcfb41d24e07e577",
    stakeAmount: 10000,
    eventMarketInformation: { matchId: "sr:match:73281486" },
    betDateTime: "2026-08-31T06:36:01.058Z",
  });
  const now = new Date("2026-09-24T07:30:00.000Z").getTime();

  // No live-matches entries at all for this matchId -- matches the real
  // confirmed state (14 of 15 real matchIds are simply absent).
  const overdue = findOverdueSettlementBets([bet], [], now);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].betId, "6a9520d1c16e52500924b3ee");
  assert.equal(overdue[0].reason, "match_absent_from_feed");
  assert.equal(overdue[0].minutesSinceMatchEnded, null, "no end-timestamp exists once the match drops off the feed");
  assert.equal(overdue[0].stakeAmount, 10000);
});

// Ended + >15min -- the originally-specified case. Not observed in real
// data (Ended essentially never appears live), so this is a synthetic
// fixture exercising the designed-for path defensively.
test("findOverdueSettlementBets: a match still present with status Ended for over 15 minutes IS flagged", () => {
  const bet = pendingBet({ eventMarketInformation: { matchId: "sr:match:1" } });
  const match = liveMatch({ matchId: "sr:match:1", status: "Ended", updatedAt: "2026-09-24T07:00:00.000Z" });
  const now = new Date("2026-09-24T07:20:00.000Z").getTime(); // 20 minutes later

  const overdue = findOverdueSettlementBets([bet], [match], now);
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].reason, "match_ended_over_15min");
  assert.equal(overdue[0].minutesSinceMatchEnded, 20);
});

test("findOverdueSettlementBets: a match Ended less than 15 minutes ago is NOT flagged yet", () => {
  const bet = pendingBet({ eventMarketInformation: { matchId: "sr:match:1" } });
  const match = liveMatch({ matchId: "sr:match:1", status: "Ended", updatedAt: "2026-09-24T07:00:00.000Z" });
  const now = new Date("2026-09-24T07:10:00.000Z").getTime(); // 10 minutes later

  const overdue = findOverdueSettlementBets([bet], [match], now);
  assert.equal(overdue.length, 0, "still within the 15-minute grace period");
});

test("findOverdueSettlementBets: exactly 15 minutes is NOT overdue -- strictly greater than, matching the tech team's own threshold semantics", () => {
  const bet = pendingBet({ eventMarketInformation: { matchId: "sr:match:1" } });
  const match = liveMatch({ matchId: "sr:match:1", status: "Ended", updatedAt: "2026-09-24T07:00:00.000Z" });
  const now = new Date("2026-09-24T07:15:00.000Z").getTime(); // exactly 15 minutes

  const overdue = findOverdueSettlementBets([bet], [match], now);
  assert.equal(overdue.length, 0);
});

test("findOverdueSettlementBets: NotStarted/Suspended matches are never flagged, regardless of age", () => {
  const notStarted = pendingBet({ _id: "b1", eventMarketInformation: { matchId: "sr:match:1" } });
  const suspended = pendingBet({ _id: "b2", eventMarketInformation: { matchId: "sr:match:2" } });
  const matches = [
    liveMatch({ matchId: "sr:match:1", status: "NotStarted", updatedAt: "2026-01-01T00:00:00.000Z" }),
    liveMatch({ matchId: "sr:match:2", status: "Suspended", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const now = new Date("2026-09-24T07:30:00.000Z").getTime();

  const overdue = findOverdueSettlementBets([notStarted, suspended], matches, now);
  assert.equal(overdue.length, 0);
});

test("findOverdueSettlementBets: a bet with no matchId at all is skipped, not guessed at", () => {
  const bet = pendingBet({ eventMarketInformation: {} });
  const overdue = findOverdueSettlementBets([bet], [], Date.now());
  assert.equal(overdue.length, 0);
});

// Real: sr:match:73285234 appears 4 times among the 26 real pending bets
// (a Simulated Reality League cricket match, also absent from live-matches).
test("summarizeOverdueByMatch: groups multiple overdue bets on the same real match into one summary", () => {
  const bets = [
    pendingBet({ _id: "6a8fe3de933517fed4fbf3a0", stakeAmount: 3, eventMarketInformation: { matchId: "sr:match:73285234" } }),
    pendingBet({ _id: "6a8edfeb2c6b7298776c0029", stakeAmount: 200, eventMarketInformation: { matchId: "sr:match:73285234" } }),
  ];
  const overdue = findOverdueSettlementBets(bets, [], Date.now());
  const byMatch = summarizeOverdueByMatch(overdue);

  assert.equal(byMatch.length, 1);
  assert.equal(byMatch[0].matchId, "sr:match:73285234");
  assert.equal(byMatch[0].overdueBetCount, 2);
  assert.equal(byMatch[0].totalOverdueStake, 203);
});

test("summarizeOverdueByMatch: no overdue bets -> empty summary, not an error", () => {
  assert.deepEqual(summarizeOverdueByMatch([]), []);
});
