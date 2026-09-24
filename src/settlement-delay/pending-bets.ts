import { getAllSportsbookData } from "../crm/index.js";
import type { SportsbookBet } from "../crm/index.js";

// bet_status=pending is a real, confirmed server-side filter (2026-09-24) —
// getAllSportsbookData("/crm/all-sportsbook-data") returns exactly the
// pending rows directly (26 real bets, totalPages: 1 at limit 100), not an
// approximation we filter client-side from the full unfiltered set. Loops
// pages defensively in case the real count ever exceeds one page's limit.
export async function getPendingBets(): Promise<SportsbookBet[]> {
  const bets: SportsbookBet[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await getAllSportsbookData({ page, limit: 100, bet_status: "pending" });
    bets.push(...result.bets);
    totalPages = result.pagination.totalPages;
    page++;
  } while (page <= totalPages);

  return bets;
}
