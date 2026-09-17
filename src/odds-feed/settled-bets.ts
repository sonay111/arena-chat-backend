import { pool } from "../db.js";
import { REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID } from "../activity/shared.js";

export type RawBetSettledRow = {
  betId: string | null;
  status: string | null;
  matchId: string | null;
  receivedAt: Date;
};

export type SettledBetCounts = { won: number; lost: number; void: number };

// Confirmed real statuses (2026-09-17): won, lost, void, cashed_out. void
// and cashed_out aren't a win or a loss, so they get their own "void"
// bucket rather than being forced into won/lost or silently dropped.
const VOID_STATUSES = new Set(["void", "cashed_out"]);

// Pure counting logic, separated from the DB fetch below — same pattern as
// computeActiveBetCounts (active-bets.ts). bet_settled never carries a
// `legs` array (confirmed: 0 of 25 real rows have one) — unlike
// bet_placed, a settled bet only ever references one match, via
// eventMarketInformation.matchId. The "multi-leg consideration" that
// still applies here is dedup: raw_webhook_events is append-only, so the
// same bet _id can appear more than once (confirmed live — a synthetic
// test bet settled twice) — last row wins, same convention as active bets.
export function computeSettledBetCounts(rows: RawBetSettledRow[]): Map<string, SettledBetCounts> {
  const latestByBetId = new Map<string, { status: string | null; matchId: string | null }>();
  const sorted = [...rows].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  for (const row of sorted) {
    if (!row.betId) continue;
    latestByBetId.set(row.betId, { status: row.status, matchId: row.matchId });
  }

  const counts = new Map<string, SettledBetCounts>();
  for (const bet of latestByBetId.values()) {
    if (!bet.matchId || !bet.status) continue;

    const current = counts.get(bet.matchId) ?? { won: 0, lost: 0, void: 0 };
    if (bet.status === "won") current.won += 1;
    else if (bet.status === "lost") current.lost += 1;
    else if (VOID_STATUSES.has(bet.status)) current.void += 1;
    else continue; // an unrecognized status -- don't force it into any bucket

    counts.set(bet.matchId, current);
  }

  return counts;
}

export async function getSettledBetCounts(): Promise<Map<string, SettledBetCounts>> {
  const { rows } = await pool.query(
    `SELECT payload->'data'->>'_id' AS bet_id,
            payload->'data'->>'status' AS status,
            payload->'data'->'eventMarketInformation'->>'matchId' AS match_id,
            received_at
     FROM raw_webhook_events
     WHERE event_name = 'sportsbook.bet_settled'
       AND user_id ~ $1
       AND user_id != $2
       AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
       AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'`,
    [REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
  );

  const parsedRows: RawBetSettledRow[] = rows.map((r) => ({
    betId: r.bet_id,
    status: r.status,
    matchId: r.match_id,
    receivedAt: r.received_at,
  }));

  return computeSettledBetCounts(parsedRows);
}
