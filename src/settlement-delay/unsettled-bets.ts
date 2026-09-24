import { getAllUnsettledBets } from "../crm/index.js";
import type { SportsbookBet, BetSummary } from "../crm/index.js";

export type UnsettledBetsResult = {
  bets: SportsbookBet[];
  summary: BetSummary;
};

const EMPTY_SUMMARY: BetSummary = {
  totalStakeAmount: 0,
  averageBetAmount: 0,
  winLossAmount: 0,
  customerGGR: 0,
  customerNGR: 0,
};

// /crm/all-unsettled-bets is now the authoritative source (confirmed real
// 2026-09-24) -- always returns pending bets whose match has ended AND the
// player still exists, replacing our own DIY match_absent_from_feed
// inference against live-matches. Paginates defensively in case the real
// count ever exceeds one page's limit (only 2 real bets today, totalPages:
// 1), same convention as every other paginated CRM fetch in this project.
// summary is the endpoint's own real aggregate (totalStakeAmount etc.),
// taken from the first page -- confirmed this represents the whole
// filtered dataset, not just that page's slice, same as every other
// section API's summary cards.
export async function getAllUnsettledBetsAcrossPages(): Promise<UnsettledBetsResult> {
  const bets: SportsbookBet[] = [];
  let page = 1;
  let totalPages = 1;
  let summary: BetSummary = EMPTY_SUMMARY;

  do {
    const result = await getAllUnsettledBets({ page, limit: 100 });
    bets.push(...result.bets);
    totalPages = result.pagination.totalPages;
    if (page === 1) summary = result.summary;
    page++;
  } while (page <= totalPages);

  return { bets, summary };
}
