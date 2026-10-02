import { buildPendingWithdrawalMessage } from "./message";

// Step 2 of the pending-withdrawal flow: decide whether to notify the
// customer about one withdrawal, build the text, and (only if switched on)
// send it. Everything that touches the outside world -- the database read
// and the actual send -- is passed in, so this logic is testable with
// stand-ins and never needs a database or the real Support Chat API.
//
// Two safety switches, both off/closed by default, because the live feed
// carries REAL players' withdrawals:
//   1. PENDING_WITHDRAWAL_TEST_PLAYER_IDS -- comma-separated player ids.
//      Only these players are ever considered. Empty list = nobody.
//   2. PENDING_WITHDRAWAL_SEND=true -- without it, this is a dry run: it
//      reports what it WOULD send and sends nothing.

export type WithdrawalForNotice = {
  paymentId: string;
  userId: string;
  paymentType: string;
  status: string | null;
  paymentStatus: string | null;
  gateway: string | null;
  username: string | null;
};

export type NotifyDeps = {
  loadWithdrawal: (paymentId: string) => Promise<WithdrawalForNotice | null>;
  send: (userId: string, text: string) => Promise<void>;
  allowedPlayerIds: string[];
  sendEnabled: boolean;
};

export type NotifyResult =
  | { outcome: "sent" | "dry_run"; userId: string; text: string }
  | { outcome: "skipped"; reason: string };

// "Pending" = either status field says so. The real .initiated payload had
// status "progress" with payment_status "pending"; the withdrawal seen in
// the delay feed had status "pending". The full list of status values is
// still unconfirmed with the tech team, so this accepts both for now.
export function isPending(w: Pick<WithdrawalForNotice, "status" | "paymentStatus">): boolean {
  return w.status === "pending" || w.paymentStatus === "pending";
}

export async function notifyPendingWithdrawal(paymentId: string, deps: NotifyDeps): Promise<NotifyResult> {
  const w = await deps.loadWithdrawal(paymentId);

  if (!w) return { outcome: "skipped", reason: "payment not found" };
  if (w.paymentType !== "withdrawal") return { outcome: "skipped", reason: "not a withdrawal" };
  if (!deps.allowedPlayerIds.includes(w.userId)) return { outcome: "skipped", reason: "player not on the test allowlist" };
  if (!isPending(w)) return { outcome: "skipped", reason: `not pending (status=${w.status}, payment_status=${w.paymentStatus})` };
  if (!w.username) return { outcome: "skipped", reason: "username unknown" };

  const text = buildPendingWithdrawalMessage({
    username: w.username,
    status: "pending",
    gateway: w.gateway,
  });

  if (!deps.sendEnabled) return { outcome: "dry_run", userId: w.userId, text };

  await deps.send(w.userId, text);
  return { outcome: "sent", userId: w.userId, text };
}
