import { crmGet } from "./client.js";
import type {
  Pagination,
  CrmUser,
  PaymentTransaction,
  SportsbookBet,
  CasinoSession,
  ActiveBonus,
  BetSummary,
} from "./types.js";

type PageParams = { page?: number; limit?: number };
type DateRangeParams = { start_date?: string; end_date?: string };

// Section APIs (deposit/withdrawal/sportsbook/casino/bonuses) nest
// pagination inside `data` as totalPage/currentPage/totalData. get-users
// does not follow this shape (see getUsers below), so this helper is only
// used by the other five.
function toPagination(data: { currentPage: number; totalPage: number; totalData: number }): Pagination {
  return {
    page: data.currentPage,
    totalPages: data.totalPage,
    totalRows: data.totalData,
  };
}

// /crm/get-users — the doc's example response is `{ message, data: [...] }`,
// an array directly, with no pagination fields shown. It also has no
// documented :userId path variant (unlike every other endpoint below).
//
// UNVERIFIED: whether a `userId` query param actually filters this down to
// one user, or whether it's ignored and always returns the full list. The
// "User APIs support both path and query style" note in the doc is written
// right before the endpoint matrix and its two path-style examples are
// both for deposit-history — it's not clear it covers get-users too. Worth
// confirming once we have API access; getPlayerContext (below) depends on
// this working.
export async function getUsers(params: PageParams & { userId?: string } = {}): Promise<{ users: CrmUser[] }> {
  const json = await crmGet<{ message: string; data: CrmUser[] }>("/crm/get-users", params);
  return { users: json.data };
}

export async function getDepositHistory(
  userId: string,
  params: PageParams & { payment_status?: string } & DateRangeParams = {}
): Promise<{
  deposits: PaymentTransaction[];
  pagination: Pagination;
  summary: { numberOfDeposits: number; totalDepositAmount: number; averageDepositAmount: number };
}> {
  const json = await crmGet<{ data: any }>(`/crm/deposit-history/${userId}`, params);
  return {
    deposits: json.data.depositTransactionsHistory,
    pagination: toPagination(json.data),
    summary: {
      numberOfDeposits: json.data.numberOfDeposits,
      totalDepositAmount: json.data.totalDepositAmount,
      averageDepositAmount: json.data.averageDepositAmount,
    },
  };
}

export async function getWithdrawalHistory(
  userId: string,
  params: PageParams & { payment_status?: string } & DateRangeParams = {}
): Promise<{
  withdrawals: PaymentTransaction[];
  pagination: Pagination;
  summary: { numberOfWithdrawals: number; totalWithdrawalAmount: number; averageWithdrawalAmount: number };
}> {
  const json = await crmGet<{ data: any }>(`/crm/withdrawal-history/${userId}`, params);
  return {
    withdrawals: json.data.withdrawalTransactionsHistory,
    pagination: toPagination(json.data),
    summary: {
      numberOfWithdrawals: json.data.numberOfWithdrawals,
      totalWithdrawalAmount: json.data.totalWithdrawalAmount,
      averageWithdrawalAmount: json.data.averageWithdrawalAmount,
    },
  };
}

export async function getSportsbookData(
  userId: string,
  params: PageParams & { bet_status?: string } & DateRangeParams = {}
): Promise<{ bets: SportsbookBet[]; pagination: Pagination; summary: BetSummary }> {
  const json = await crmGet<{ data: any }>(`/crm/sportsbook-data/${userId}`, params);
  return {
    bets: json.data.betHistory,
    pagination: toPagination(json.data),
    summary: {
      totalStakeAmount: json.data.totalStakeAmount,
      averageBetAmount: json.data.averageBetAmount,
      winLossAmount: json.data.winLossAmount,
      customerGGR: json.data.customerGGR,
      customerNGR: json.data.customerNGR,
    },
  };
}

export async function getCasinoData(
  userId: string,
  params: PageParams & { status?: string } & DateRangeParams = {}
): Promise<{ sessions: CasinoSession[]; pagination: Pagination; summary: BetSummary }> {
  const json = await crmGet<{ data: any }>(`/crm/casino-data/${userId}`, params);
  return {
    sessions: json.data.gameHistory,
    pagination: toPagination(json.data),
    summary: {
      totalStakeAmount: json.data.totalStakeAmount,
      averageBetAmount: json.data.averageBetAmount,
      winLossAmount: json.data.winLossAmount,
      customerGGR: json.data.customerGGR,
      customerNGR: json.data.customerNGR,
    },
  };
}

export async function getActiveBonuses(
  userId: string,
  params: PageParams = {}
): Promise<{ bonuses: ActiveBonus[]; pagination: Pagination }> {
  const json = await crmGet<{ data: any }>(`/crm/active-bonuses/${userId}`, params);
  return {
    bonuses: json.data.activeBonuses,
    pagination: toPagination(json.data),
  };
}
