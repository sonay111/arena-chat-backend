// Maps the odds feed's sportId codes to a display name + color. No
// reference table exists anywhere (checked every doc in docs/ — none
// relate to the odds feed at all), so entries only go in here once
// independently confirmed, not from inferring off tournament/team-name
// patterns alone. Anything not listed falls back to "Unknown" via
// getSportInfo() below rather than guessing.
export type SportInfo = {
  name: string;
  color: string;
};

export const SPORT_MAPPING: Record<string, SportInfo> = {
  // Confirmed 2026-09-17 directly against the real Arena365 site (seen in
  // our data under "Czech Liga Pro" / "Challenger Series" — individual
  // player-vs-player matches, never team names).
  "sr:sport:20": { name: "Table Tennis", color: "#06B6D4" },
  // Confirmed 2026-09-17 directly against the real Arena365 site, each
  // cross-checked against the site's own sport-filtered Live tab (same
  // tournament/match names as what we see in our data).
  "sr:sport:21": { name: "Cricket", color: "#22C55E" },
  "sr:sport:5": { name: "Tennis", color: "#EAB308" },
  "sr:sport:1": { name: "Football", color: "#F97316" },
};

const UNKNOWN_SPORT: SportInfo = { name: "Unknown", color: "#9CA3AF" };

export function getSportInfo(sportId: string | undefined): SportInfo {
  if (sportId === undefined) return UNKNOWN_SPORT;
  return SPORT_MAPPING[sportId] ?? UNKNOWN_SPORT;
}

// Distinct from getSportInfo — returns undefined for an unmapped sportId
// rather than the "Unknown" placeholder. GET /live-matches uses this: a
// literal "Unknown" string would look the same for every unmapped sport,
// hiding which specific one it actually is — the exact gap that made
// identifying sr:sport:20 slower than it needed to be. Callers that want
// this instead should keep the raw sportId visible (already in the
// response) so a not-yet-mapped sport stays identifiable.
export function lookupSportInfo(sportId: string | undefined): SportInfo | undefined {
  if (sportId === undefined) return undefined;
  return SPORT_MAPPING[sportId];
}
