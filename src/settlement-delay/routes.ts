import { Router } from "express";
import type { Request, Response } from "express";
import { getAllUnsettledBetsAcrossPages } from "./unsettled-bets.js";
import type { UnsettledBetsResult } from "./unsettled-bets.js";
import { toOverdueSettlementBets, summarizeOverdueByMatch } from "./detect.js";

// fetchUnsettledBets is injectable so tests can stub the CRM call, same
// rationale as every other injectable router in this project -- real CRM
// calls depend on our server's IP being allowlisted, and there's no
// mocking library here.
export function createSettlementDelayRouter(
  fetchUnsettledBets: () => Promise<UnsettledBetsResult> = getAllUnsettledBetsAcrossPages
): Router {
  const router = Router();

  // Sourced entirely from /crm/all-unsettled-bets (confirmed real
  // 2026-09-24) -- the platform's own authoritative "this bet is stuck"
  // answer, replacing the old DIY cross-reference against our own
  // live-matches tracking. Response shape (overdueBets/byMatch) is
  // unchanged from that version so nothing downstream needs to change;
  // `summary` is new/additive, using the endpoint's own real aggregate
  // totals rather than re-summing overdueBets ourselves.
  router.get("/settlement-delays", async (_req: Request, res: Response) => {
    try {
      const { bets, summary } = await fetchUnsettledBets();
      const overdueBets = toOverdueSettlementBets(bets);
      const byMatch = summarizeOverdueByMatch(overdueBets);

      res.json({ overdueBets, byMatch, summary });
    } catch (err) {
      console.error("GET /settlement-delays failed:", err);
      res.status(500).json({ ok: false });
    }
  });

  return router;
}

export const settlementDelayRouter = createSettlementDelayRouter();
