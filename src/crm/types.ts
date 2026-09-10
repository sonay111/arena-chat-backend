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
