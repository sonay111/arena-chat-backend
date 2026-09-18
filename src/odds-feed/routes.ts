import { Router } from "express";
import type { Request, Response } from "express";
import { getLiveMatches } from "../crm/index.js";
import type { GetLiveMatchesResponse } from "../crm/index.js";
import { getActiveBetCounts, getActiveStakeByCurrency } from "./active-bets.js";
import type { StakeByCurrency } from "./active-bets.js";
import { getSettledBetCounts } from "./settled-bets.js";
import { getMatchBetHistory } from "./match-bet-history.js";
import { normalizeCrmMatch, computeFeedStatus } from "./crm-live-matches.js";

// Per the 2026-09-18 investigation: matches sitting in event_status Live
// with no real update for 12-20+ hours were common and very likely
// stuck/stale, not genuinely live. 6 hours is a deliberately generous
// cutoff — comfortably longer than any real match's expected duration —
// so this only catches matches that are almost certainly stuck, not just
// a quiet stretch of play.
const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

// No lastUpdatedAt at all is NOT treated as stale — we have no evidence
// either way, and excluding it would risk hiding a genuinely fresh match.
// Hasn't actually been observed from the CRM endpoint (every real match so
// far has carried a real updatedAt), unlike our old odds-feed-derived
// state where this branch mattered a lot more.
function isStale(lastUpdatedAtMs: number | null, now: number): boolean {
  if (lastUpdatedAtMs === null) return false;
  return now - lastUpdatedAtMs > STALE_THRESHOLD_MS;
}

// fetchLiveMatches is injectable so tests can stub the CRM call — same
// rationale as checkWithdrawalDelays/createGoalInferenceRouter: no mocking
// library in this project, and real CRM calls depend on our server's IP
// being allowlisted.
export function createOddsFeedRouter(
  fetchLiveMatches: () => Promise<GetLiveMatchesResponse> = getLiveMatches
): Router {
  const router = Router();

  // As of 2026-09-18 this sources its data from the CRM's own
  // /crm/live-matches (the real, correct "what's actually on the site"
  // list) instead of our own socket listener's in-memory state — that
  // listener's accumulated Live count had grown to 260+, mostly stuck/
  // stale entries (see the investigation same day). The response
  // contract below is unchanged so the Lovable frontend needs no changes;
  // src/odds-feed/crm-live-matches.ts does the CRM-shape -> our-shape
  // normalization. The old listener (connection.ts/state.ts) is left in
  // place, just no longer wired as this route's source, in case it's
  // needed for something the CRM endpoint doesn't cover.
  router.get("/live-matches", async (req: Request, res: Response) => {
    const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
    const tournamentIdFilter = typeof req.query.tournamentId === "string" ? req.query.tournamentId : undefined;
    const includeStale = req.query.includeStale === "true";

    try {
      const [crmData, activeBetCounts, settledBetCounts, activeStakeByCurrency] = await Promise.all([
        fetchLiveMatches(),
        getActiveBetCounts(),
        getSettledBetCounts(),
        getActiveStakeByCurrency(),
      ]);

      const now = Date.now();
      let staleExcludedCount = 0;
      const matches = [];

      for (const rawMatch of crmData.matches) {
        const normalized = normalizeCrmMatch(rawMatch);

        if (statusFilter !== undefined && normalized.eventStatus !== statusFilter) continue;
        // tournamentId is always null from this source (see
        // crm-live-matches.ts) -- this filter has nothing left to match
        // against and will exclude everything if used. Not special-cased
        // away; left as a real, known limitation.
        if (tournamentIdFilter !== undefined && normalized.tournamentId !== tournamentIdFilter) continue;

        // Only applied for an explicit status=Live request, per what was
        // asked — fetching everything (no status filter) or another
        // status entirely never triggers this.
        if (statusFilter === "Live" && !includeStale && isStale(normalized.lastUpdatedAtMs, now)) {
          staleExcludedCount++;
          continue;
        }

        matches.push({
          matchId: normalized.matchId,
          name: normalized.name,
          sportId: normalized.sportId,
          sportName: normalized.sportName,
          sportColor: normalized.sportColor,
          tournamentId: normalized.tournamentId,
          tournamentName: normalized.tournamentName,
          categoryName: normalized.categoryName,
          countryCode: normalized.countryCode,
          event_status: normalized.eventStatus,
          scheduledTime: normalized.scheduledTime,
          // Purely informational -- not a filter. Nothing here excludes
          // SRL matches; this just spares the frontend from string-matching
          // categoryName/region itself.
          isSimulated: normalized.isSimulated,
          // Explicitly 0, not undefined/null, for a match with no real
          // active bets — activeBetCounts.get() only has entries for
          // matchIds that actually appear in some real bet's legs[].
          activeBetCount: activeBetCounts.get(normalized.matchId) ?? 0,
          // Grouped by currency, e.g. { "USDT": 2, "INR": 500 } — never
          // summed across currencies, since that would be a meaningless
          // number. Empty object, not undefined/null, when there's no
          // active stake at all for this match. Same active-bet filtering
          // and multi-leg consideration as activeBetCount (see
          // active-bets.ts's getActiveBets/matchIdsForBet).
          totalActiveStake: activeStakeByCurrency.get(normalized.matchId) ?? ({} as StakeByCurrency),
          // { won, lost, void } rather than one combined number —
          // void/cashed_out outcomes get their own bucket rather than
          // being forced into won/lost or silently dropped.
          settledBetCount: settledBetCounts.get(normalized.matchId) ?? { won: 0, lost: 0, void: 0 },
          lastUpdatedAt: normalized.lastUpdatedAtMs !== null ? new Date(normalized.lastUpdatedAtMs).toISOString() : null,
        });
      }

      // connected here means "the CRM call itself succeeded" — a
      // different concept than before (previously our own socket's
      // connection state), but the same field name/meaning-at-a-glance:
      // false means something is actually broken right now.
      const feedHealth = {
        connected: true,
        producers: Object.fromEntries(
          Object.entries(crmData.feed ?? {}).map(([producerId, connected]) => [
            producerId,
            { raw: { producer_id: Number(producerId), connection: connected }, receivedAt: now },
          ])
        ),
      };

      // A single top-level value, not repeated per match — this signal
      // (from the CRM's `feed` object) is identical for every match in a
      // given response, since there's no per-match producer link to derive
      // it from individually. See computeFeedStatus's comment for what
      // each value means, including why "degraded" (a real mixed result)
      // is kept distinct from "unconfirmed" (genuinely no data).
      const feedStatus = computeFeedStatus(crmData.feed);

      res.json({ matches, feedHealth, feedStatus, staleExcludedCount });
    } catch (err) {
      console.error("GET /live-matches failed (CRM /crm/live-matches call):", err);
      res.status(500).json({ ok: false });
    }
  });

  // Not gated on the match currently being in the CRM's live list — this
  // is real history, so a match that already ended is still a valid thing
  // to ask about. Untouched by the CRM switch above: always DB-only.
  router.get("/live-matches/:matchId/bets", async (req: Request<{ matchId: string }>, res: Response) => {
    const { matchId } = req.params;

    try {
      const { openBets, settledBets } = await getMatchBetHistory(matchId);
      res.json({ openBets, settledBets });
    } catch (err) {
      console.error(`GET /live-matches/${matchId}/bets failed:`, err);
      res.status(500).json({ ok: false });
    }
  });

  return router;
}

export const oddsFeedRouter = createOddsFeedRouter();
