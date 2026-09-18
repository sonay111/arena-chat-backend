import { Router } from "express";
import type { Request, Response } from "express";
import { matchStore, feedStatusStore, isOddsFeedConnected } from "./connection.js";
import type { MatchState, FeedStatus } from "./state.js";
import { getActiveBetCounts } from "./active-bets.js";
import { getSettledBetCounts } from "./settled-bets.js";
import type { SettledBetCounts } from "./settled-bets.js";
import { getMatchBetHistory } from "./match-bet-history.js";
import { lookupSportInfo } from "./sport-mapping.js";

export const oddsFeedRouter = Router();

// Per the 2026-09-18 investigation: matches sitting in event_status Live
// with no status change for 12-20+ hours were common and very likely
// stuck/stale, not genuinely live. 6 hours is a deliberately generous cutoff
// — comfortably longer than any real match's expected duration — so this
// only catches matches that are almost certainly stuck, not just a quiet
// stretch of play.
const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

// No lastUpdatedAt at all (e.g. a match only ever seen via match_status/
// bet_stop, never a timestamped odds message) is NOT treated as stale —
// we have no evidence either way, and excluding it would risk hiding a
// genuinely fresh match just because of which event types happened to
// arrive for it.
function isStale(state: MatchState, now: number): boolean {
  if (state.lastTimestamp === undefined) return false;
  return now - state.lastTimestamp > STALE_THRESHOLD_MS;
}

// `event_status` deliberately keeps the feed's own snake_case field name
// (every other field mirrors the feed's camelCase) — this response is
// meant to mirror the wire shape as closely as possible rather than
// normalize it, since that's what was asked for.
export type ProducerStatus = "connected" | "disconnected" | "unconfirmed";

// Three distinct states, not a boolean — "we've never received feed_status
// for this producer" and "we received it and it said disconnected" are
// different situations for a frontend to show (e.g. "unconfirmed" vs.
// "stale"), and collapsing them both into `false` (an earlier version of
// this endpoint did exactly that) hides which one it actually is.
function getProducerStatus(producerId: string | undefined, producers: Map<string, FeedStatus>): ProducerStatus {
  if (producerId === undefined) return "unconfirmed"; // no producerId captured for this match at all
  const status = producers.get(producerId);
  if (!status) return "unconfirmed"; // no feed_status ever seen for this producer
  const connection = (status.raw as any)?.connection;
  if (connection === true) return "connected";
  if (connection === false) return "disconnected";
  return "unconfirmed"; // feed_status seen, but its connection field wasn't a clear boolean
}

function toResponseShape(
  state: MatchState,
  producers: Map<string, FeedStatus>,
  activeBetCounts: Map<string, number>,
  settledBetCounts: Map<string, SettledBetCounts>
) {
  // sportId is kept exactly as-is (never removed/replaced). sportName/
  // sportColor are resolved on top of it, but null (not the string
  // "Unknown") for anything not yet in SPORT_MAPPING — a literal
  // "Unknown" would look identical for every unmapped sport, hiding which
  // one it actually is. The raw sportId is what lets the frontend still
  // show a distinguishable badge for it, same as before sr:sport:20 was
  // identified.
  const sportInfo = lookupSportInfo(state.sportId);

  return {
    matchId: state.matchId,
    name: state.name,
    sportId: state.sportId,
    sportName: sportInfo?.name ?? null,
    sportColor: sportInfo?.color ?? null,
    tournamentId: state.tournamentId,
    tournamentName: state.tournamentName,
    categoryName: state.categoryName,
    countryCode: state.countryCode,
    event_status: state.eventStatus,
    scheduledTime: state.scheduledTime,
    producerId: state.producerId,
    producerStatus: getProducerStatus(state.producerId, producers),
    // Explicitly 0, not undefined/null, for a match with no real active
    // bets — activeBetCounts.get() only has entries for matchIds that
    // actually appear in some real bet's legs[].
    activeBetCount: activeBetCounts.get(state.matchId) ?? 0,
    // { won, lost, void } rather than one combined number — void/cashed_out
    // outcomes get their own bucket rather than being forced into won/lost
    // or silently dropped (see settled-bets.ts).
    settledBetCount: settledBetCounts.get(state.matchId) ?? { won: 0, lost: 0, void: 0 },
    // The internal lastTimestamp (epoch ms), as an ISO string — null when
    // this match has never had a timestamped message applied (see
    // isStale's comment above for why that's treated as "unknown", not
    // "stale").
    lastUpdatedAt: state.lastTimestamp !== undefined ? new Date(state.lastTimestamp).toISOString() : null,
  };
}

oddsFeedRouter.get("/live-matches", async (req: Request, res: Response) => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const tournamentIdFilter = typeof req.query.tournamentId === "string" ? req.query.tournamentId : undefined;
  const includeStale = req.query.includeStale === "true";

  const [activeBetCounts, settledBetCounts] = await Promise.all([getActiveBetCounts(), getSettledBetCounts()]);

  const now = Date.now();
  let staleExcludedCount = 0;
  const matches = [];
  for (const state of matchStore.values()) {
    if (statusFilter !== undefined && state.eventStatus !== statusFilter) continue;
    if (tournamentIdFilter !== undefined && state.tournamentId !== tournamentIdFilter) continue;

    // Only applied for an explicit status=Live request, per what was
    // asked — fetching everything (no status filter) or another status
    // entirely never triggers this.
    if (statusFilter === "Live" && !includeStale && isStale(state, now)) {
      staleExcludedCount++;
      continue;
    }

    matches.push(toResponseShape(state, feedStatusStore, activeBetCounts, settledBetCounts));
  }

  // connected: the concrete, always-available signal — real feed_status
  // traffic (confirmed live 2026-09-17: { producer_id, connection }) can
  // still legitimately be empty if no producer has reported yet. A
  // frontend should treat `connected: false` as "feed is down" and an
  // empty `matches` array with `connected: true` as "genuinely quiet
  // right now" — those are not the same thing. Per-match producerConnected
  // above is the finer-grained version of the same idea.
  const feedHealth = {
    connected: isOddsFeedConnected(),
    producers: Object.fromEntries(feedStatusStore),
  };

  res.json({ matches, feedHealth, staleExcludedCount });
});

// Not gated on the match currently being in matchStore — this is real
// history, so a match that already ended (and dropped out of the live
// state) is still a valid thing to ask about.
oddsFeedRouter.get("/live-matches/:matchId/bets", async (req: Request<{ matchId: string }>, res: Response) => {
  const { matchId } = req.params;

  try {
    const { openBets, settledBets } = await getMatchBetHistory(matchId);
    res.json({ openBets, settledBets });
  } catch (err) {
    console.error(`GET /live-matches/${matchId}/bets failed:`, err);
    res.status(500).json({ ok: false });
  }
});
