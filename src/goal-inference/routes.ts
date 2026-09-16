import { Router } from "express";
import type { Request, Response } from "express";
import { getPlayerContext, CrmApiError } from "../crm/index.js";
import type { PlayerContext } from "../crm/index.js";
import { inferGoal } from "./infer.js";
import type { GoalInferencePlayer } from "./infer.js";
import { buildWebhookHistory } from "./webhook-history.js";

// fetchPlayerContext is injectable so tests can stub the CRM call, same
// rationale as checkWithdrawalDelays (src/alerts/withdrawal-delay-detector.ts)
// — no mocking library in this project, and real CRM calls depend on our
// server's IP being allowlisted.
export function createGoalInferenceRouter(
  fetchPlayerContext: (userId: string) => Promise<PlayerContext> = getPlayerContext
): Router {
  const router = Router();

  // CRM lookup failure (not found, IP not allowlisted, network error — all
  // CrmApiError, see src/crm/errors.ts) is expected, not exceptional: it
  // just means Tier 1 has no data to work with, so inferGoal falls through
  // to Tier 2 on its own. Only a non-CRM error (e.g. our own DB failing)
  // should actually 500 this route.
  router.get("/goal-inference/:playerId", async (req: Request<{ playerId: string }>, res: Response) => {
    const { playerId } = req.params;

    try {
      let player: GoalInferencePlayer | null = null;
      try {
        const context = await fetchPlayerContext(playerId);
        if (context.identity) {
          player = {
            recentWithdrawals: context.recentWithdrawals,
            recentDeposits: context.recentDeposits,
          };
        }
      } catch (err) {
        if (!(err instanceof CrmApiError)) throw err;
      }

      const webhookHistory = await buildWebhookHistory(playerId);
      const inference = inferGoal({ player, webhookHistory });

      res.json({ inference });
    } catch (err) {
      console.error(`GET /goal-inference/${playerId} failed:`, err);
      res.status(500).json({ ok: false });
    }
  });

  return router;
}

export const goalInferenceRouter = createGoalInferenceRouter();
