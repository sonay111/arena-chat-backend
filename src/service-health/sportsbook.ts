import { isOddsFeedConnected } from "../odds-feed/connection.js";
import { getLiveMatches } from "../crm/index.js";
import type { GetLiveMatchesResponse } from "../crm/index.js";
import { normalizeCrmMatch } from "../odds-feed/crm-live-matches.js";
import { aggregateStatus } from "./aggregate.js";
import type { NormalizedCategory, NormalizedLeaf, StatusValue } from "./types.js";

// Sportsbook is deliberately NOT sourced from GET /service-health at all --
// Satyam's endpoint doesn't cover it, and we already have real signal from
// our own odds-feed integration (src/odds-feed/): our own socket
// connection's live state, and each currently-live match's real
// producerStatus. Same worst-of-children rule as every other category.
export async function computeSportsbookHealth(
  fetchLiveMatches: () => Promise<GetLiveMatchesResponse> = getLiveMatches,
  connected: () => boolean = isOddsFeedConnected
): Promise<NormalizedCategory> {
  const connectionCheck: NormalizedLeaf = {
    kind: "leaf",
    key: "odds_feed_connection",
    label: "Odds Feed Connection",
    method: "internal",
    status: connected() ? "ok" : "down",
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    responseTimeMs: null,
  };

  let producerCheck: NormalizedLeaf;
  try {
    const { matches } = await fetchLiveMatches();
    const statuses: StatusValue[] = matches.map((match) => {
      const producerStatus = normalizeCrmMatch(match).producerStatus;
      if (producerStatus === "connected") return "ok";
      if (producerStatus === "disconnected") return "down";
      return "unknown";
    });
    producerCheck = {
      kind: "leaf",
      key: "producer_status",
      label: "Producer Status (current live matches)",
      method: "internal",
      // No live matches at all is unknown, not ok -- there's simply
      // nothing to check right now, same principle as an all-unknown
      // flows[] group in aggregateStatus.
      status: statuses.length === 0 ? "unknown" : aggregateStatus(statuses),
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      responseTimeMs: null,
    };
  } catch (err) {
    producerCheck = {
      kind: "leaf",
      key: "producer_status",
      label: "Producer Status (current live matches)",
      method: "internal",
      status: "unknown",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: (err as Error).message,
      responseTimeMs: null,
    };
  }

  return {
    key: "sportsbook",
    label: "Sportsbook",
    status: aggregateStatus([connectionCheck.status, producerCheck.status]),
    realCoverage: "full",
    checks: [connectionCheck, producerCheck],
  };
}
