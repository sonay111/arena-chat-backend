import type { CrmLiveMatch } from "../crm/types.js";
import { SPORT_MAPPING } from "./sport-mapping.js";

// The CRM's own live-matches feed uses inconsistent casing for the same
// conceptual status — confirmed live 2026-09-18: two cricket matches sent
// "not_started" (snake_case) while a tennis match on the SAME call sent
// "NotStarted" (PascalCase). Normalized here case- and
// underscore-insensitively into our canonical four-value set. "Ended"
// hasn't actually been observed from this endpoint yet — included
// defensively since our own former data source did use it. Anything
// totally unrecognized passes through as-is rather than being hidden
// (e.g. "Interrupted", observed live 2026-09-18 and not yet in this set),
// so a genuinely new status value stays visible.
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

export type ProducerStatus = "connected" | "disconnected" | "unconfirmed";

// Restored to genuine per-match logic now that the CRM sends real
// producerId/connection per match (confirmed live 2026-09-18, replacing
// the earlier response's top-level `feed` object, which no longer exists
// at all). producerId and connection have always been observed together —
// both null (no producer link yet, e.g. correlates with hasOdds: false)
// or both populated — so null on either is treated as "unconfirmed" rather
// than guessing.
export function computeProducerStatus(producerId: number | null, connection: boolean | null): ProducerStatus {
  if (producerId === null || connection === null) return "unconfirmed";
  return connection ? "connected" : "disconnected";
}

export type NormalizedCrmMatch = {
  matchId: string;
  name: string;
  sportId: string;
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
  // backend excludes these matches.
  isSimulated: boolean;
  producerStatus: ProducerStatus;
  // Purely informational, same principle as isSimulated — a match with
  // hasOdds: false is NOT excluded from results; the frontend can label it
  // (e.g. "Markets Banned") instead of hiding it.
  hasOdds: boolean;
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
  // sportId now comes directly from the CRM (confirmed live 2026-09-18) —
  // no more reverse-deriving it from sportName, and no more Soccer/
  // Football synonym workaround (that was only ever needed because we had
  // to guess the code from the name).
  const sportColor = SPORT_MAPPING[match.sportId]?.color ?? null;

  const parsedUpdatedAt = match.updatedAt ? new Date(match.updatedAt).getTime() : NaN;
  const lastUpdatedAtMs = Number.isNaN(parsedUpdatedAt) ? null : parsedUpdatedAt;

  return {
    matchId: match.matchId,
    name: `${match.team1Name} vs. ${match.team2Name}`,
    sportId: match.sportId,
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
    producerStatus: computeProducerStatus(match.producerId, match.connection),
    hasOdds: match.hasOdds,
  };
}
