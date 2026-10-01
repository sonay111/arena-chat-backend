import { getUsers, getDepositHistory, getWithdrawalHistory, getActiveBonuses } from "./endpoints.js";
import type { CrmBrand } from "./client.js";
import { CrmApiError } from "./errors.js";
import type { CrmUser, PaymentTransaction, ActiveBonus } from "./types.js";

export type PlayerContext = {
  identity: CrmUser | null;
  recentDeposits: PaymentTransaction[];
  recentWithdrawals: PaymentTransaction[];
  activeBonuses: ActiveBonus[];
};

const RECENT_LIMIT = 10;

// One clean object for a support agent (or the AI layer later) looking at
// a single player: who they are, their recent money movement, and what
// bonuses are currently active. Deliberately small — bets/casino history
// are their own detailed views (getSportsbookData/getCasinoData), not part
// of this at-a-glance context.
export async function getPlayerContext(userId: string, brand: CrmBrand): Promise<PlayerContext> {
  const [usersResult, depositsResult, withdrawalsResult, bonusesResult] = await Promise.all([
    getUsers(brand, { userId, limit: 1 }),
    getDepositHistory(userId, brand, { limit: RECENT_LIMIT }),
    getWithdrawalHistory(userId, brand, { limit: RECENT_LIMIT }),
    getActiveBonuses(userId, brand, { limit: RECENT_LIMIT }),
  ]);

  // See the UNVERIFIED note on getUsers in endpoints.ts — if the userId
  // filter turns out to be ignored, this still finds the right user as
  // long as they appear somewhere in whatever page comes back.
  const identity = usersResult.users.find((u) => u._id === userId) ?? null;

  return {
    identity,
    recentDeposits: depositsResult.deposits,
    recentWithdrawals: withdrawalsResult.withdrawals,
    activeBonuses: bonusesResult.bonuses,
  };
}

// For callers that have a userId but no way to know which brand it
// belongs to (confirmed gap — webhook payloads carry no brand signal as
// of 2026-09-30). Tries CrazyBet first, and only on a confirmed "this user
// doesn't exist here" 404 does it retry against Arena365. Any other
// failure (network, IP not allowed, etc.) propagates immediately without
// retrying — retrying a non-404 failure against the other tenant wouldn't
// tell us anything new, it would just double the failure.
export async function getPlayerContextAnyBrand(userId: string): Promise<PlayerContext> {
  try {
    return await getPlayerContext(userId, "crazybet");
  } catch (err) {
    if (err instanceof CrmApiError && err.status === 404) {
      return await getPlayerContext(userId, "arena365");
    }
    throw err;
  }
}
