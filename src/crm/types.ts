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
