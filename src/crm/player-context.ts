import { getUsers, getDepositHistory, getWithdrawalHistory, getActiveBonuses } from "./endpoints.js";
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
export async function getPlayerContext(userId: string): Promise<PlayerContext> {
  const [usersResult, depositsResult, withdrawalsResult, bonusesResult] = await Promise.all([
    getUsers({ userId, limit: 1 }),
    getDepositHistory(userId, { limit: RECENT_LIMIT }),
    getWithdrawalHistory(userId, { limit: RECENT_LIMIT }),
    getActiveBonuses(userId, { limit: RECENT_LIMIT }),
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
