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

// Section APIs (deposit/withdrawal/sportsbook/casino/bonuses), and now
// get-users too (confirmed 2026-09-10, see below), nest pagination inside
// `data` as totalPage/currentPage/totalData.
function toPagination(data: { currentPage: number; totalPage: number; totalData: number }): Pagination {
  return {
    page: data.currentPage,
    totalPages: data.totalPage,
    totalRows: data.totalData,
  };
}

type GetUsersResponse = {
  message: string;
  data: { users: CrmUser[]; totalPage: number; currentPage: number; totalData: number };
};

// Pure parsing step, split out from getUsers so it's directly testable
// against a real captured response shape without needing a live network
// call or a mocking library (neither exists elsewhere in this project) —
// same rationale as isValidSignature in src/webhooks/auth.ts.
export function parseGetUsersResponse(json: GetUsersResponse): { users: CrmUser[]; pagination: Pagination } {
  return { users: json.data.users, pagination: toPagination(json.data) };
}

// /crm/get-users — the doc's example response is `{ message, data: [...] }`,
// a flat array directly, with no pagination fields shown.
//
// CONFIRMED 2026-09-10, after Satyam updated the API: real responses are
// actually `{ status, message, data: { users: [...], totalPage,
// currentPage, totalData } }` — an envelope matching every other section
// API below, not the flat array the doc showed. The doc's shape was never
// actually seen in real traffic even before this change (see the git
// history of this file) — this just makes it official and adds
// pagination to match. The userId query param has been directly confirmed
// to filter to that one user (see getPlayerContext below, which depends
// on it).
export async function getUsers(
  params: PageParams & { userId?: string } = {}
): Promise<{ users: CrmUser[]; pagination: Pagination }> {
  const json = await crmGet<GetUsersResponse>("/crm/get-users", params);
  return parseGetUsersResponse(json);
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

// ===== All-users variants =====
// Same shapes as the per-user endpoints above, minus the userId path
// segment — these list across every player rather than one.

export async function getAllDepositHistory(
  params: PageParams & { payment_status?: string } & DateRangeParams = {}
): Promise<{
  deposits: PaymentTransaction[];
  pagination: Pagination;
  summary: { numberOfDeposits: number; totalDepositAmount: number; averageDepositAmount: number };
}> {
  const json = await crmGet<{ data: any }>("/crm/all-deposit-history", params);
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

export async function getAllWithdrawalHistory(
  params: PageParams & { payment_status?: string } & DateRangeParams = {}
): Promise<{
  withdrawals: PaymentTransaction[];
  pagination: Pagination;
  summary: { numberOfWithdrawals: number; totalWithdrawalAmount: number; averageWithdrawalAmount: number };
}> {
  const json = await crmGet<{ data: any }>("/crm/all-withdrawal-history", params);
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

// The doc's one concrete Date Filters example (start_date/end_date) is
// shown specifically against this endpoint, so date-range support here is
// confirmed, not extrapolated like on the per-user sportsbook endpoint.
export async function getAllSportsbookData(
  params: PageParams & { bet_status?: string } & DateRangeParams = {}
): Promise<{ bets: SportsbookBet[]; pagination: Pagination; summary: BetSummary }> {
  const json = await crmGet<{ data: any }>("/crm/all-sportsbook-data", params);
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

// DOC CONTRADICTION (same as the per-user casino endpoint): the Common
// Params table lists bet_status as "Sportsbook/casino status filter",
// implying it applies here, but the doc's own Casino Data code example
// filters with `status`, not `bet_status`. We follow the concrete example
// and only accept `status` — bet_status is not supported for casino.
export async function getAllCasinoData(
  params: PageParams & { status?: string } & DateRangeParams = {}
): Promise<{ sessions: CasinoSession[]; pagination: Pagination; summary: BetSummary }> {
  const json = await crmGet<{ data: any }>("/crm/all-casino-data", params);
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

export async function getAllActiveBonuses(
  params: PageParams = {}
): Promise<{ bonuses: ActiveBonus[]; pagination: Pagination }> {
  const json = await crmGet<{ data: any }>("/crm/all-active-bonuses", params);
  return {
    bonuses: json.data.activeBonuses,
    pagination: toPagination(json.data),
  };
}
