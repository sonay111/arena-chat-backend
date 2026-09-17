import { pool } from "../db.js";
import { REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID } from "../activity/shared.js";

export type RawBetPlacedRow = {
  betId: string | null;
  status: string | null;
  legs: unknown;
  receivedAt: Date;
};

// Pure counting logic, separated from the DB fetch below so it's testable
// without Postgres — same pattern as parseGetUsersResponse (src/crm/endpoints.ts).
//
// A bet counts toward a match only if: its most recent bet_placed row
// (raw_webhook_events is append-only, so a bet_id can in principle appear
// more than once — last one wins, same convention as payments) has
// status "open", AND its _id has no corresponding sportsbook.bet_settled
// event yet. A single bet can span multiple matches via multiple legs —
// each distinct matchId in its legs gets +1, but the same matchId
// appearing twice in one bet's legs only counts once for that bet.
export function computeActiveBetCounts(
  rows: RawBetPlacedRow[],
  settledBetIds: Set<string>
): Map<string, number> {
  const latestByBetId = new Map<string, { status: string | null; legs: unknown }>();
  const sorted = [...rows].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  for (const row of sorted) {
    if (!row.betId) continue;
    latestByBetId.set(row.betId, { status: row.status, legs: row.legs });
  }

  const counts = new Map<string, number>();
  for (const [betId, bet] of latestByBetId) {
    if (bet.status !== "open") continue;
    if (settledBetIds.has(betId)) continue;

    const matchIds = new Set<string>();
    const legs = Array.isArray(bet.legs) ? bet.legs : [];
    for (const leg of legs) {
      const matchId = (leg as any)?.matchId;
      if (typeof matchId === "string") matchIds.add(matchId);
    }

    for (const matchId of matchIds) {
      counts.set(matchId, (counts.get(matchId) ?? 0) + 1);
    }
  }

  return counts;
}

// Real players only — same exclusion convention used everywhere else in
// this codebase (src/activity/shared.ts): 24-char lowercase hex user_id,
// not the synthetic 000...001 fixture, and not a test_/tail_ event_id.
export async function getActiveBetCounts(): Promise<Map<string, number>> {
  const { rows: placedRows } = await pool.query(
    `SELECT payload->'data'->>'_id' AS bet_id,
            payload->'data'->>'status' AS status,
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

  const { rows: settledRows } = await pool.query(
    `SELECT DISTINCT payload->'data'->>'_id' AS bet_id
     FROM raw_webhook_events
     WHERE event_name = 'sportsbook.bet_settled'`
  );
  const settledBetIds = new Set<string>(settledRows.map((r) => r.bet_id).filter(Boolean));

  const parsedRows: RawBetPlacedRow[] = placedRows.map((r) => ({
    betId: r.bet_id,
    status: r.status,
    legs: r.legs,
    receivedAt: r.received_at,
  }));

  return computeActiveBetCounts(parsedRows, settledBetIds);
}
