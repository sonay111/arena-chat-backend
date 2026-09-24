import { Router } from "express";
import type { Request, Response } from "express";
import { getLiveMatches } from "../crm/index.js";
import type { GetLiveMatchesResponse, SportsbookBet } from "../crm/index.js";
import { getPendingBets } from "./pending-bets.js";
import { findOverdueSettlementBets, summarizeOverdueByMatch } from "./detect.js";

// Both dependencies are injectable so tests can stub the CRM calls, same
// rationale as every other injectable router in this project (real CRM
// calls depend on our server's IP being allowlisted, and there's no
// mocking library here).
export function createSettlementDelayRouter(
  fetchPendingBets: () => Promise<SportsbookBet[]> = getPendingBets,
  fetchLiveMatches: () => Promise<GetLiveMatchesResponse> = getLiveMatches
): Router {
  const router = Router();

  // No new API from the tech team -- built entirely from two calls we
  // already have confirmed real access to: the CRM's pending sportsbook
  // bets (bet_status=pending) and its live-matches feed. See detect.ts
  // for the overdue rule and the 2026-09-24 investigation notes on why
  // "absent from the feed" is handled as its own case.
  router.get("/settlement-delays", async (_req: Request, res: Response) => {
    try {
      const [pendingBets, liveMatchesResponse] = await Promise.all([fetchPendingBets(), fetchLiveMatches()]);
      const overdueBets = findOverdueSettlementBets(pendingBets, liveMatchesResponse.matches, Date.now());
      const byMatch = summarizeOverdueByMatch(overdueBets);

      res.json({ overdueBets, byMatch });
    } catch (err) {
      console.error("GET /settlement-delays failed:", err);
      res.status(500).json({ ok: false });
    }
  });

  return router;
}

export const settlementDelayRouter = createSettlementDelayRouter();
