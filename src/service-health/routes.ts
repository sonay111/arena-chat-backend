import { Router } from "express";
import type { Request, Response } from "express";
import { fetchRawServiceHealth } from "./fetch-raw.js";
import { normalizeServiceHealth } from "./normalize.js";
import { computeSportsbookHealth } from "./sportsbook.js";
import type { RawServiceHealthResponse, NormalizedCategory } from "./types.js";

// Both dependencies are injectable so tests can stub the CRM call and the
// sportsbook derivation independently -- same rationale as every other
// injectable router in this project (createOddsFeedRouter,
// createGoalInferenceRouter): no mocking library here, and real CRM calls
// depend on our server's IP being allowlisted.
export function createServiceHealthRouter(
  fetchRaw: () => Promise<RawServiceHealthResponse> = fetchRawServiceHealth,
  fetchSportsbook: () => Promise<NormalizedCategory> = computeSportsbookHealth
): Router {
  const router = Router();

  router.get("/service-health", async (_req: Request, res: Response) => {
    try {
      const [raw, sportsbook] = await Promise.all([fetchRaw(), fetchSportsbook()]);
      res.json(normalizeServiceHealth(raw, sportsbook));
    } catch (err) {
      console.error("GET /service-health failed:", err);
      res.status(500).json({ ok: false });
    }
  });

  return router;
}

export const serviceHealthRouter = createServiceHealthRouter();
