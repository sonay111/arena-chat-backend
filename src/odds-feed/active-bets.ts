import { pool } from "../db.js";
import { REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID } from "../activity/shared.js";

export type RawBetPlacedRow = {
  betId: string | null;
  status: string | null;
  legs: unknown;
  stake: number | null;
  currency: string | null;
  receivedAt: Date;
};

type ActiveBet = { legs: unknown; stake: number | null; currency: string | null };

// Shared by computeActiveBetCounts and computeActiveStakeByCurrency below —
// both need exactly the same "what currently counts as an active bet"
// filtering, just aggregated differently. A bet counts as active only if:
// its most recent bet_placed row (raw_webhook_events is append-only, so a
// bet_id can in principle appear more than once — last one wins, same
// convention as payments) has status "open", AND its _id has no
// corresponding sportsbook.bet_settled event yet.
function getActiveBets(rows: RawBetPlacedRow[], settledBetIds: Set<string>): ActiveBet[] {
  const latestByBetId = new Map<string, RawBetPlacedRow>();
  const sorted = [...rows].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  for (const row of sorted) {
    if (!row.betId) continue;
    latestByBetId.set(row.betId, row);
  }

  const active: ActiveBet[] = [];
  for (const [betId, bet] of latestByBetId) {
    if (bet.status !== "open") continue;
    if (settledBetIds.has(betId)) continue;
    active.push({ legs: bet.legs, stake: bet.stake, currency: bet.currency });
  }
  return active;
}

// A single bet can span multiple matches via multiple legs — each
// distinct matchId in its legs is returned once, even if it appears
// more than once within the same bet's legs.
function matchIdsForBet(legs: unknown): Set<string> {
  const matchIds = new Set<string>();
  const arr = Array.isArray(legs) ? legs : [];
  for (const leg of arr) {
    const matchId = (leg as any)?.matchId;
    if (typeof matchId === "string") matchIds.add(matchId);
  }
  return matchIds;
}

// Pure counting logic, separated from the DB fetch below so it's testable
// without Postgres — same pattern as parseGetUsersResponse (src/crm/endpoints.ts).
export function computeActiveBetCounts(rows: RawBetPlacedRow[], settledBetIds: Set<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const bet of getActiveBets(rows, settledBetIds)) {
    for (const matchId of matchIdsForBet(bet.legs)) {
      counts.set(matchId, (counts.get(matchId) ?? 0) + 1);
    }
  }
  return counts;
}

export type StakeByCurrency = Record<string, number>;

// Same active-bet filtering and multi-leg consideration as
// computeActiveBetCounts, but summing stakeAmount instead of counting —
// grouped by currency rather than combined into one number, since bets
// come in different currencies (real data has both USDT and INR) and
// summing across them would be meaningless.
export function computeActiveStakeByCurrency(
  rows: RawBetPlacedRow[],
  settledBetIds: Set<string>
): Map<string, StakeByCurrency> {
  const sums = new Map<string, StakeByCurrency>();
  for (const bet of getActiveBets(rows, settledBetIds)) {
    if (bet.stake === null || !bet.currency) continue;
    for (const matchId of matchIdsForBet(bet.legs)) {
      const perMatch = sums.get(matchId) ?? {};
      perMatch[bet.currency] = (perMatch[bet.currency] ?? 0) + bet.stake;
      sums.set(matchId, perMatch);
    }
  }
  return sums;
}

// Real players only — same exclusion convention used everywhere else in
// this codebase (src/activity/shared.ts): 24-char lowercase hex user_id,
// not the synthetic 000...001 fixture, and not a test_/tail_ event_id.
async function fetchRawBetPlacedRows(): Promise<RawBetPlacedRow[]> {
  const { rows } = await pool.query(
    `SELECT payload->'data'->>'_id' AS bet_id,
            payload->'data'->>'status' AS status,
            payload->'data'->'legs' AS legs,
            payload->'data'->>'stakeAmount' AS stake,
            payload->'data'->>'currency' AS currency,
            received_at
     FROM raw_webhook_events
     WHERE event_name = 'sportsbook.bet_placed'
       AND user_id ~ $1
       AND user_id != $2
       AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
       AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'`,
    [REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
  );

  return rows.map((r) => ({
    betId: r.bet_id,
    status: r.status,
    legs: r.legs,
    stake: r.stake !== null ? Number(r.stake) : null,
    currency: r.currency,
    receivedAt: r.received_at,
  }));
}

async function fetchSettledBetIds(): Promise<Set<string>> {
  const { rows } = await pool.query(
    `SELECT DISTINCT payload->'data'->>'_id' AS bet_id
     FROM raw_webhook_events
     WHERE event_name = 'sportsbook.bet_settled'`
  );
  return new Set<string>(rows.map((r) => r.bet_id).filter(Boolean));
}

export async function getActiveBetCounts(): Promise<Map<string, number>> {
  const [placedRows, settledBetIds] = await Promise.all([fetchRawBetPlacedRows(), fetchSettledBetIds()]);
  return computeActiveBetCounts(placedRows, settledBetIds);
}

export async function getActiveStakeByCurrency(): Promise<Map<string, StakeByCurrency>> {
  const [placedRows, settledBetIds] = await Promise.all([fetchRawBetPlacedRows(), fetchSettledBetIds()]);
  return computeActiveStakeByCurrency(placedRows, settledBetIds);
}
