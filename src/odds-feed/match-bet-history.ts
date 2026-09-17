import { pool } from "../db.js";
import { REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID } from "../activity/shared.js";

export type BetHistoryEntry = {
  betId: string;
  playerId: string;
  stake: number | null;
  odds: number | null;
  marketName: string | null;
  status: string;
  timestamp: string | null;
};

export type MatchBetHistory = {
  openBets: BetHistoryEntry[];
  settledBets: BetHistoryEntry[];
};

export type RawPlacedRow = {
  betId: string | null;
  userId: string | null;
  status: string | null;
  odds: number | null;
  stake: number | null;
  marketName: string | null;
  betDateTime: string | null;
  legs: unknown;
  receivedAt: Date;
};

export type RawSettledRow = {
  betId: string | null;
  userId: string | null;
  status: string | null;
  stake: number | null;
  marketName: string | null;
  betDateTime: string | null;
  receivedAt: Date;
};

function legsIncludeMatch(legs: unknown, matchId: string): boolean {
  const arr = Array.isArray(legs) ? legs : [];
  return arr.some((leg: any) => leg?.matchId === matchId);
}

function dedupeLatest<T extends { betId: string | null; receivedAt: Date }>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  const sorted = [...rows].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  for (const row of sorted) {
    if (!row.betId) continue;
    latest.set(row.betId, row);
  }
  return latest;
}

// Pure joining logic, separated from the DB fetch below — same pattern as
// computeActiveBetCounts/computeSettledBetCounts. placedRows is expected
// to be ALL real bet_placed rows (unfiltered by match — a bet's match
// association lives inside its legs[], so filtering happens here, in JS,
// same as active-bets.ts). settledRows is expected to already be
// filtered to this matchId (bet_settled has no legs[], so its
// eventMarketInformation.matchId can be filtered directly in SQL).
//
// A bet_settled row always wins over a still-open bet_placed row for the
// same _id (a bet can't be both). odds only ever comes from bet_placed
// (bet_settled never carries it) — a settled bet whose original
// bet_placed was never captured just shows odds: null rather than
// dropping the bet entirely.
export function computeMatchBetHistory(
  matchId: string,
  placedRows: RawPlacedRow[],
  settledRows: RawSettledRow[]
): MatchBetHistory {
  const latestPlaced = dedupeLatest(placedRows);
  const latestSettled = dedupeLatest(settledRows);

  const openBets: BetHistoryEntry[] = [];
  const settledBets: BetHistoryEntry[] = [];

  for (const [betId, placed] of latestPlaced) {
    if (!legsIncludeMatch(placed.legs, matchId)) continue;

    const settled = latestSettled.get(betId);
    if (settled) {
      settledBets.push({
        betId,
        playerId: settled.userId ?? placed.userId ?? "",
        stake: settled.stake ?? placed.stake,
        odds: placed.odds,
        marketName: settled.marketName ?? placed.marketName,
        status: settled.status ?? "unknown",
        timestamp: settled.betDateTime ?? placed.betDateTime,
      });
    } else if (placed.status === "open") {
      openBets.push({
        betId,
        playerId: placed.userId ?? "",
        stake: placed.stake,
        odds: placed.odds,
        marketName: placed.marketName,
        status: "open",
        timestamp: placed.betDateTime,
      });
    }
  }

  // A settled bet whose original bet_placed was never captured (missing
  // event, or arrived on a different matchId by mistake) still belongs in
  // the real history for this match — settledRows is already pre-filtered
  // to this matchId, so anything not already handled above goes in as-is.
  for (const [betId, settled] of latestSettled) {
    if (latestPlaced.has(betId)) continue;
    settledBets.push({
      betId,
      playerId: settled.userId ?? "",
      stake: settled.stake,
      odds: null,
      marketName: settled.marketName,
      status: settled.status ?? "unknown",
      timestamp: settled.betDateTime,
    });
  }

  return { openBets, settledBets };
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export async function getMatchBetHistory(matchId: string): Promise<MatchBetHistory> {
  const { rows: placedRaw } = await pool.query(
    `SELECT payload->'data'->>'_id' AS bet_id,
            payload->'data'->>'userId' AS user_id,
            payload->'data'->>'status' AS status,
            payload->'data'->>'odds' AS odds,
            payload->'data'->>'stakeAmount' AS stake,
            payload->'data'->'eventMarketInformation'->>'marketName' AS market_name,
            payload->'data'->>'betDateTime' AS bet_date_time,
            payload->'data'->'legs' AS legs,
            received_at
     FROM raw_webhook_events
     WHERE event_name = 'sportsbook.bet_placed'
       AND user_id ~ $1
       AND user_id != $2
       AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
       AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'`,
    [REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
  );

  const { rows: settledRaw } = await pool.query(
    `SELECT payload->'data'->>'_id' AS bet_id,
            payload->'data'->>'userId' AS user_id,
            payload->'data'->>'status' AS status,
            payload->'data'->>'stakeAmount' AS stake,
            payload->'data'->'eventMarketInformation'->>'marketName' AS market_name,
            payload->'data'->>'betDateTime' AS bet_date_time,
            received_at
     FROM raw_webhook_events
     WHERE event_name = 'sportsbook.bet_settled'
       AND payload->'data'->'eventMarketInformation'->>'matchId' = $1
       AND user_id ~ $2
       AND user_id != $3
       AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
       AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'`,
    [matchId, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
  );

  const placedRows: RawPlacedRow[] = placedRaw.map((r) => ({
    betId: r.bet_id,
    userId: r.user_id,
    status: r.status,
    odds: toNumber(r.odds),
    stake: toNumber(r.stake),
    marketName: r.market_name,
    betDateTime: r.bet_date_time,
    legs: r.legs,
    receivedAt: r.received_at,
  }));

  const settledRows: RawSettledRow[] = settledRaw.map((r) => ({
    betId: r.bet_id,
    userId: r.user_id,
    status: r.status,
    stake: toNumber(r.stake),
    marketName: r.market_name,
    betDateTime: r.bet_date_time,
    receivedAt: r.received_at,
  }));

  return computeMatchBetHistory(matchId, placedRows, settledRows);
}
