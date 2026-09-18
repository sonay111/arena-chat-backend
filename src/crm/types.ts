export type Pagination = {
  page: number;
  totalPages: number;
  totalRows: number;
};

export type CrmUser = {
  _id: string;
  username: string;
  firstName?: string;
  email?: string;
  phone?: string;
  // A phone dialing code (e.g. "91", "374"), NOT an ISO 3166-1 alpha-2
  // country code — confirmed 2026-09-10 against real adminapiqa traffic
  // after Satyam's API update. Added to getUsers' response at that point;
  // absent before. See src/crm/dialing-code-to-country.ts for turning
  // this into an actual country.
  countryCode?: string;
  createdAt: string;
  is_blocked: boolean;
};

export type PaymentTransaction = {
  _id: string;
  userId: string;
  amount: number;
  dateTime: string;
  status: string;
};

export type SportsbookBet = {
  _id: string;
  userId: string;
  stakeAmount: number;
  returnAmount: number;
  winLossAmount: number;
  eventMarketInformation: {
    matchId?: string;
    marketName?: string;
    betName?: string;
    teamName?: string;
    tournamentName?: string;
    sportsType?: string;
  };
  betDateTime: string;
  status: string;
};

export type CasinoSession = {
  session: string;
  userId: string;
  stakeAmount: number;
  returnAmount: number;
  winLossAmount: number;
  gameProvider: string;
  gameName: string;
  sessionDateTime: string;
  status: string;
};

export type ActiveBonus = {
  _id: string;
  userId: string;
  bonusType: string;
  bonusStatus: string;
  bonusAmount: number;
  expiryDate: string;
};

export type BetSummary = {
  totalStakeAmount: number;
  averageBetAmount: number;
  winLossAmount: number;
  customerGGR: number;
  customerNGR: number;
};

// /crm/live-matches — reconfirmed live 2026-09-18 after Satyam updated it.
// No matching doc exists (checked every file in docs/); this shape is
// purely from real captured responses. `status` is still inconsistently
// cased upstream ("Live"/"Suspended"/"NotStarted" AND "not_started" all
// appeared across the same response — see
// src/odds-feed/crm-live-matches.ts's normalizeMatchStatus). There's still
// no per-match tournamentId or countryCode. This update added three real
// fields that didn't exist before: `sportId` (the actual sr:sport:N code,
// no longer something we have to reverse-derive from sportName),
// `producerId`/`connection` (genuinely per-match now — the earlier
// response's top-level `feed` object is gone entirely), and `hasOdds`
// (false for a match with no producer link yet, confirmed to correlate
// with producerId/connection both being null).
export type CrmLiveMatch = {
  matchId: string;
  sportId: string;
  status: string;
  sportName: string;
  team1Name: string;
  team2Name: string;
  tournamentName: string;
  region: string | null;
  startTime: string;
  updatedAt: string;
  producerId: number | null;
  connection: boolean | null;
  hasOdds: boolean;
};
