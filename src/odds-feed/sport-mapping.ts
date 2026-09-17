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
};

const UNKNOWN_SPORT: SportInfo = { name: "Unknown", color: "#9CA3AF" };

export function getSportInfo(sportId: string | undefined): SportInfo {
  if (sportId === undefined) return UNKNOWN_SPORT;
  return SPORT_MAPPING[sportId] ?? UNKNOWN_SPORT;
}
