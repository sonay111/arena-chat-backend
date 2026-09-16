import { Router } from "express";
import type { Request, Response } from "express";
import { matchStore, feedStatusStore, isOddsFeedConnected } from "./connection.js";
import type { MatchState } from "./state.js";

export const oddsFeedRouter = Router();

// `event_status` deliberately keeps the feed's own snake_case field name
// (every other field mirrors the feed's camelCase) — this response is
// meant to mirror the wire shape as closely as possible rather than
// normalize it, since that's what was asked for.
function toResponseShape(state: MatchState) {
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
  };
}

oddsFeedRouter.get("/live-matches", (req: Request, res: Response) => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const tournamentIdFilter = typeof req.query.tournamentId === "string" ? req.query.tournamentId : undefined;

  const matches = [];
  for (const state of matchStore.values()) {
    if (statusFilter !== undefined && state.eventStatus !== statusFilter) continue;
    if (tournamentIdFilter !== undefined && state.tournamentId !== tournamentIdFilter) continue;
    matches.push(toResponseShape(state));
  }

  // connected: the concrete, always-available signal — feed_status
  // messages haven't been observed in real traffic at all yet, so
  // `producers` may legitimately be empty even while fully healthy. A
  // frontend should treat `connected: false` as "feed is down" and an
  // empty `matches` array with `connected: true` as "genuinely quiet
  // right now" — those are not the same thing.
  const feedHealth = {
    connected: isOddsFeedConnected(),
    producers: Object.fromEntries(feedStatusStore),
  };

  res.json({ matches, feedHealth });
});
