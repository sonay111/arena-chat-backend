import { Router } from "express";
import type { Request, Response } from "express";
import { matchStore, feedStatusStore, isOddsFeedConnected } from "./connection.js";
import type { MatchState, FeedStatus } from "./state.js";

export const oddsFeedRouter = Router();

// `event_status` deliberately keeps the feed's own snake_case field name
// (every other field mirrors the feed's camelCase) — this response is
// meant to mirror the wire shape as closely as possible rather than
// normalize it, since that's what was asked for.
//
// producerConnected defaults to false whenever we can't positively confirm
// the producer is connected — no producerId captured yet (e.g. this match
// has only ever come in via match_status/bet_stop, never odds), or no
// feed_status ever seen for that producer, or its last known
// `connection` value isn't literally true. This is a deliberate choice:
// "unconfirmed" and "known disconnected" both read as "don't fully trust
// this yet" rather than defaulting stale/unknown data to look trustworthy.
function toResponseShape(state: MatchState, producers: Map<string, FeedStatus>) {
  const producerStatus = state.producerId !== undefined ? producers.get(state.producerId) : undefined;
  const producerConnected = (producerStatus?.raw as any)?.connection === true;

  return {
    matchId: state.matchId,
    name: state.name,
    sportId: state.sportId,
    tournamentId: state.tournamentId,
    tournamentName: state.tournamentName,
    categoryName: state.categoryName,
    countryCode: state.countryCode,
    event_status: state.eventStatus,
    scheduledTime: state.scheduledTime,
    producerId: state.producerId,
    producerConnected,
  };
}

oddsFeedRouter.get("/live-matches", (req: Request, res: Response) => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const tournamentIdFilter = typeof req.query.tournamentId === "string" ? req.query.tournamentId : undefined;

  const matches = [];
  for (const state of matchStore.values()) {
    if (statusFilter !== undefined && state.eventStatus !== statusFilter) continue;
    if (tournamentIdFilter !== undefined && state.tournamentId !== tournamentIdFilter) continue;
    matches.push(toResponseShape(state, feedStatusStore));
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
