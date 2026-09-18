import type { CrmLiveMatch } from "../crm/types.js";
import { SPORT_MAPPING } from "./sport-mapping.js";

// The CRM's own live-matches feed uses inconsistent casing for the same
// conceptual status — confirmed live 2026-09-18: two cricket matches sent
// "not_started" (snake_case) while a tennis match on the SAME call sent
// "NotStarted" (PascalCase). Normalized here case- and
// underscore-insensitively into our canonical four-value set. "Ended"
// hasn't actually been observed from this endpoint yet (only Live/
// Suspended/both NotStarted spellings, across one 10-match sample) —
// included defensively since our own former data source did use it.
// Anything totally unrecognized passes through as-is rather than being
// hidden, so a genuinely new status value stays visible.
const CANONICAL_STATUSES: Record<string, string> = {
  live: "Live",
  suspended: "Suspended",
  notstarted: "NotStarted",
  ended: "Ended",
};

export function normalizeMatchStatus(raw: string): string {
  const key = raw.toLowerCase().replace(/_/g, "");
  return CANONICAL_STATUSES[key] ?? raw;
}

// The CRM calls this sport "Soccer"; our own SPORT_MAPPING (built from the
// raw odds feed, independently confirmed against the real site) calls the
// same sport "Football". Both are accepted here so sr:sport:1's id/color
// still resolve — without this, every Soccer match would silently show as
// unmapped even though we do know this sport.
const SPORT_NAME_SYNONYMS: Record<string, string> = {
  soccer: "football",
};

function findSportIdByName(sportName: string): string | undefined {
  const normalized = SPORT_NAME_SYNONYMS[sportName.toLowerCase()] ?? sportName.toLowerCase();
  for (const [sportId, info] of Object.entries(SPORT_MAPPING)) {
    if (info.name.toLowerCase() === normalized) return sportId;
  }
  return undefined;
}

export type NormalizedCrmMatch = {
  matchId: string;
  name: string;
  sportId: string | null;
  sportName: string;
  sportColor: string | null;
  // The CRM doesn't carry a per-match tournamentId or countryCode at all —
  // both are always null here, a real gap versus the old odds-feed-derived
  // shape. In particular, ?tournamentId= filtering has nothing left to
  // match against; this isn't silently papered over anywhere.
  tournamentId: null;
  tournamentName: string | null;
  categoryName: string | null;
  countryCode: null;
  eventStatus: string;
  scheduledTime: string | null;
  // Parsed from the CRM's own `updatedAt` — a real, authoritative
  // per-match timestamp, unlike the epoch-ms lastTimestamp our own former
  // odds-feed state tracked (which only ever moved on an `odds` message).
  // null only if updatedAt was missing/unparseable, not a real case
  // observed yet.
  lastUpdatedAtMs: number | null;
  // Explicit, dedicated flag so the frontend doesn't need to string-match
  // categoryName/region itself. SRL matches are real, legitimate, bettable
  // content — this is purely informational, not a filter; nothing in this
  // backend excludes these matches (confirmed 2026-09-18: no such filter
  // exists anywhere in this codebase — if the panel is hiding them, that's
  // in the Lovable frontend, not here).
  isSimulated: boolean;
};

// The one real literal value seen for a simulated match's region so far
// (exact case, confirmed across every SRL example in real data: region is
// always exactly "Simulated Reality League" when team/tournament names
// carry "SRL", e.g. "Zhejiang Professional Srl" / "China Super League
// SRL"). Matched on this exact region value, not a "contains SRL"
// substring check against team/tournament text — safer if a non-simulated
// match's name ever happens to contain those letters for an unrelated
// reason.
const SIMULATED_REALITY_LEAGUE_REGION = "Simulated Reality League";

export function normalizeCrmMatch(match: CrmLiveMatch): NormalizedCrmMatch {
  const sportId = findSportIdByName(match.sportName) ?? null;
  const sportColor = sportId ? SPORT_MAPPING[sportId].color : null;

  const parsedUpdatedAt = match.updatedAt ? new Date(match.updatedAt).getTime() : NaN;
  const lastUpdatedAtMs = Number.isNaN(parsedUpdatedAt) ? null : parsedUpdatedAt;

  return {
    matchId: match.matchId,
    name: `${match.team1Name} vs. ${match.team2Name}`,
    sportId,
    sportName: match.sportName,
    sportColor,
    tournamentId: null,
    tournamentName: match.tournamentName ?? null,
    categoryName: match.region ?? null,
    countryCode: null,
    eventStatus: normalizeMatchStatus(match.status),
    scheduledTime: match.startTime ?? null,
    lastUpdatedAtMs,
    isSimulated: match.region === SIMULATED_REALITY_LEAGUE_REGION,
  };
}

// The CRM's `feed` object has no per-match producer link at all — unlike
// our own former odds-feed state, which tracked a specific producerId per
// match, this is one single global snapshot for the whole response, not
// something that varies per match. That's why it's surfaced as a
// top-level `feedStatus` field on the response (see routes.ts) instead of
// being repeated identically on every match object.
//
// "connected" only when EVERY known producer reports true; "disconnected"
// only when EVERY one reports false (safe to say nothing is up).
// "degraded" is a MIXED result — some producers up, some down — which is
// real, known information, not the same as "unconfirmed": "unconfirmed" is
// reserved for genuinely having no data at all (the feed object is
// missing or empty). We also have NOT yet confirmed this "feed" signal is
// any more stable than our own former one, which flipped every producer
// within 3 minutes in earlier testing — treat it as informative, not
// authoritative.
export type FeedConnectionStatus = "connected" | "degraded" | "disconnected" | "unconfirmed";

export function computeFeedStatus(feed: Record<string, boolean> | undefined | null): FeedConnectionStatus {
  if (!feed) return "unconfirmed";
  const values = Object.values(feed);
  if (values.length === 0) return "unconfirmed";
  if (values.every((v) => v === true)) return "connected";
  if (values.every((v) => v === false)) return "disconnected";
  return "degraded";
}
