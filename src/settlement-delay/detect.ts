import type { SportsbookBet, CrmLiveMatch } from "../crm/index.js";
import { normalizeCrmMatch } from "../odds-feed/crm-live-matches.js";

export const OVERDUE_THRESHOLD_MINUTES = 15;

// "match_ended_over_15min" -- the originally-specified case: the match is
// still visible in live-matches, status Ended, and it's been over 15
// minutes since its last update. Confirmed live 2026-09-24 this basically
// never happens in practice: "Ended" essentially never appears in real
// live-matches data, and a match seems to drop out of the feed entirely
// once it's truly over rather than lingering in an Ended state.
//
// "match_absent_from_feed" -- confirmed live 2026-09-24 on 14 of 15 real
// pending-bet matchIds: the match simply isn't in live-matches at all, and
// every one of those 14 real bets is 24-132 days old (via betDateTime) --
// unambiguously over, just with no end-timestamp anywhere in our data
// once the feed stops reporting on it. Flagged immediately, no 15-minute
// wait, since there's no timestamp to measure 15 minutes against.
export type OverdueReason = "match_ended_over_15min" | "match_absent_from_feed";

export type OverdueSettlementBet = {
  betId: string;
  userId: string;
  matchId: string;
  stakeAmount: number;
  betDateTime: string;
  reason: OverdueReason;
  // Only set for match_ended_over_15min -- match_absent_from_feed has no
  // end-timestamp to compute this from.
  minutesSinceMatchEnded: number | null;
};

export type MatchOverdueSummary = {
  matchId: string;
  overdueBetCount: number;
  totalOverdueStake: number;
};

// now is injectable (epoch ms) so tests don't depend on the real wall
// clock -- same rationale as every other now-dependent pure function in
// this project (e.g. odds-feed's staleness filter).
export function findOverdueSettlementBets(
  pendingBets: SportsbookBet[],
  liveMatches: CrmLiveMatch[],
  now: number
): OverdueSettlementBet[] {
  const matchesById = new Map(liveMatches.map((m) => [m.matchId, normalizeCrmMatch(m)]));
  const overdue: OverdueSettlementBet[] = [];

  for (const bet of pendingBets) {
    const matchId = bet.eventMarketInformation?.matchId;
    // No matchId at all on the bet -- nothing to cross-reference against,
    // not treated as overdue (that would be guessing, not detecting).
    if (!matchId) continue;

    const match = matchesById.get(matchId);

    if (!match) {
      overdue.push({
        betId: bet._id,
        userId: bet.userId,
        matchId,
        stakeAmount: bet.stakeAmount,
        betDateTime: bet.betDateTime,
        reason: "match_absent_from_feed",
        minutesSinceMatchEnded: null,
      });
      continue;
    }

    if (match.eventStatus !== "Ended" || match.lastUpdatedAtMs === null) continue;

    const minutesSinceMatchEnded = (now - match.lastUpdatedAtMs) / 60_000;
    if (minutesSinceMatchEnded > OVERDUE_THRESHOLD_MINUTES) {
      overdue.push({
        betId: bet._id,
        userId: bet.userId,
        matchId,
        stakeAmount: bet.stakeAmount,
        betDateTime: bet.betDateTime,
        reason: "match_ended_over_15min",
        minutesSinceMatchEnded,
      });
    }
  }

  return overdue;
}

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
