import type { SportsbookBet } from "../crm/index.js";

// Only reason now: /crm/all-unsettled-bets (confirmed real 2026-09-24) is
// the platform's own authoritative "this bet is stuck" answer -- it already
// applies its own end-of-match + delay threshold before returning a bet, so
// there's nothing left for us to infer. Replaces the old two-reason set
// (match_ended_over_15min / match_absent_from_feed) from when we cross-
// referenced our own live-matches tracking ourselves.
export type OverdueReason = "confirmed_unsettled_by_platform";

export type OverdueSettlementBet = {
  betId: string;
  userId: string;
  matchId: string;
  stakeAmount: number;
  betDateTime: string;
  reason: OverdueReason;
  // Always null now -- the platform doesn't expose a match end-timestamp
  // on this endpoint, and we no longer compute one ourselves (no live-
  // matches cross-reference left to derive it from). Field kept, not
  // removed, so this response's shape doesn't change for anything already
  // reading it (Emerging Patterns, Live Matches).
  minutesSinceMatchEnded: null;
};

export type MatchOverdueSummary = {
  matchId: string;
  overdueBetCount: number;
  totalOverdueStake: number;
};

// Every bet /crm/all-unsettled-bets returns is already confirmed overdue --
// no filtering or threshold math left to do here, just reshape into our
// existing response contract. A bet with no matchId at all is skipped
// (nothing to group by in byMatch), same as the old behavior.
export function toOverdueSettlementBets(bets: SportsbookBet[]): OverdueSettlementBet[] {
  const overdue: OverdueSettlementBet[] = [];

  for (const bet of bets) {
    const matchId = bet.eventMarketInformation?.matchId;
    if (!matchId) continue;

    overdue.push({
      betId: bet._id,
      userId: bet.userId,
      matchId,
      stakeAmount: bet.stakeAmount,
      betDateTime: bet.betDateTime,
      reason: "confirmed_unsettled_by_platform",
      minutesSinceMatchEnded: null,
    });
  }

  return overdue;
}

// Per-match breakdown is still computed client-side -- the real endpoint's
// own aggregate (summary) is dataset-wide, not broken down by match, so
// there's no "real" per-match total to use instead of summing here.
export function summarizeOverdueByMatch(overdueBets: OverdueSettlementBet[]): MatchOverdueSummary[] {
  const byMatch = new Map<string, MatchOverdueSummary>();

  for (const bet of overdueBets) {
    const existing = byMatch.get(bet.matchId);
    if (existing) {
      existing.overdueBetCount += 1;
      existing.totalOverdueStake += bet.stakeAmount;
    } else {
      byMatch.set(bet.matchId, { matchId: bet.matchId, overdueBetCount: 1, totalOverdueStake: bet.stakeAmount });
    }
  }

  return [...byMatch.values()];
}
