import { Router } from "express";
import type { Request, Response } from "express";
import { matchStore, feedStatusStore, isOddsFeedConnected } from "./connection.js";
import type { MatchState, FeedStatus } from "./state.js";
import { getActiveBetCounts } from "./active-bets.js";
import { lookupSportInfo } from "./sport-mapping.js";

export const oddsFeedRouter = Router();

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

function toResponseShape(state: MatchState, producers: Map<string, FeedStatus>, activeBetCounts: Map<string, number>) {
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
  };
}

oddsFeedRouter.get("/live-matches", async (req: Request, res: Response) => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const tournamentIdFilter = typeof req.query.tournamentId === "string" ? req.query.tournamentId : undefined;

  const activeBetCounts = await getActiveBetCounts();

  const matches = [];
  for (const state of matchStore.values()) {
    if (statusFilter !== undefined && state.eventStatus !== statusFilter) continue;
    if (tournamentIdFilter !== undefined && state.tournamentId !== tournamentIdFilter) continue;
    matches.push(toResponseShape(state, feedStatusStore, activeBetCounts));
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

  res.json({ matches, feedHealth });
});
