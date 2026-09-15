// Goal Inference engine — a pure function, no DB/CRM calls of its own. The
// caller is responsible for assembling GoalInferenceInput from a real
// getPlayerContext() result (src/crm/player-context.ts) plus our own
// webhook history. Kept pure so it's trivially unit-testable and has no
// opinion about where its data came from.

export type RemarkedTransaction = {
  status: string;
  // The CRM's transaction objects carry far more fields than
  // PaymentTransaction (src/crm/types.ts) declares — that type is a
  // deliberately small compile-time view, not a runtime filter. `remark`
  // is one of the untyped fields that actually comes back (confirmed
  // 2026-09-15 against real recentWithdrawals/recentDeposits payloads).
  remark?: string | null;
};

export type GoalInferencePlayer = {
  recentWithdrawals: RemarkedTransaction[];
  recentDeposits: RemarkedTransaction[];
};

export type GoalInferenceWebhookHistory = {
  // Our own record of a currently-pending withdrawal, independent of
  // whatever the CRM's recentWithdrawals says — this is Tier 2's fallback
  // signal when there's no CRM data (or no remark) to reason from.
  pendingWithdrawal: { paymentId: string; amount: number } | null;
  refreshIncidentsLastHour: number;
  // True only when a bonus.expired event fired for this player AND no
  // other webhook activity (deposit/withdrawal/bet/casino) landed in the
  // same window — i.e., they let it lapse rather than used-then-quiet.
  bonusExpiredUnusedInWindow: boolean;
  // Recency guards for the bonus-expired rule, added 2026-09-15 — without
  // these, a player whose ONLY webhook history ever is a handful of old
  // bonus.expired events (genuinely dormant, not "has an active goal
  // right now") triggered the same "Claim missed bonus" card as someone
  // who just lost a bonus days ago and is still otherwise active.
  bonusExpiredWithinLast7Days: boolean;
  // At least one OTHER real event, of any type, in the last 30 days —
  // proof the account is still alive in general. Deliberately a wider,
  // separate window from bonusExpiredUnusedInWindow's tight ±1hr check:
  // no activity right around the expiry moment is exactly what "unused"
  // means, but total silence for 30 days means dormant, not "has a goal".
  hasOtherActivityLast30Days: boolean;
  registered: boolean;
  totalDepositsEver: number;
};

export type GoalInferenceInput = {
  // null when the CRM lookup for this player failed (404/not found) or
  // simply hasn't been attempted. Tier 1 (remark-based) rules only ever
  // apply when this is present — an unresolved player always falls
  // through to Tier 2.
  player: GoalInferencePlayer | null;
  webhookHistory: GoalInferenceWebhookHistory;
};

export type GoalInferenceResult = {
  goal: string;
  blocker: string;
  // Only set for remarks that are real but not safe to show a customer
  // verbatim (currently just the Frogo case) — a paraphrase to use in any
  // customer-facing surface later. Internal tooling should keep using
  // `blocker`.
  safeBlocker?: string;
  confidence: "high" | "medium" | "low";
  basedOn: string[];
};

// Known QA/test artifacts seen in real remark data (src/goal-inference —
// investigated 2026-09-15: "test", "suspicious palig", "palig's ( suspect)").
// Matched as a case-insensitive substring so variations on the same theme
// ("Palig test", "palig's test account", ...) are also caught.
const QA_ARTIFACT_PATTERN = /test|palig|suspect/i;

// Remarks confirming the withdrawal/deposit already reached a final,
// resolved state — real activity, but not an active blocker for anything.
function isResolvedRemark(remark: string): boolean {
  return (
    remark === "Rejected by admin" ||
    remark.startsWith("Approved by admin and submitted") ||
    remark === "Payelu payout initiated successfully"
  );
}

// Returns a decisive Tier 1 verdict (a card, or null meaning "resolved/
// excluded, stop looking"), or undefined meaning "this remark doesn't tell
// us anything — keep looking" (no remark, or unrecognized text).
function classifyRemark(
  remark: string | null | undefined,
  sourceField: string
): GoalInferenceResult | null | undefined {
  if (!remark) return undefined;

  if (QA_ARTIFACT_PATTERN.test(remark)) return null;

  if (remark === "Held for manual approval: user has sports bets") {
    return {
      goal: "Receive withdrawal",
      blocker: remark,
      confidence: "high",
      basedOn: [sourceField],
    };
  }

  // Matched by prefix, not exact string — the doc's own bullet uses "..."
  // here, implying the trailing detail (which service, why) can vary.
  if (remark.startsWith("Held for manual approval: Frogo verdict unavailable")) {
    return {
      goal: "Receive withdrawal",
      blocker: remark,
      safeBlocker: "Held pending risk review",
      confidence: "high",
      basedOn: [sourceField],
    };
  }

  if (isResolvedRemark(remark)) return null;

  return undefined;
}

function inferTier2(wh: GoalInferenceWebhookHistory): GoalInferenceResult | null {
  if (wh.pendingWithdrawal) {
    return {
      goal: "Receive withdrawal",
      blocker: "Awaiting manual review",
      confidence: "medium",
      basedOn: ["webhookHistory.pendingWithdrawal"],
    };
  }

  if (wh.refreshIncidentsLastHour >= 2) {
    return {
      goal: "Checking account",
      blocker: "Repeated account refreshes with no follow-up action",
      confidence: "low",
      basedOn: ["webhookHistory.refreshIncidentsLastHour"],
    };
  }

  if (wh.bonusExpiredUnusedInWindow && wh.bonusExpiredWithinLast7Days && wh.hasOtherActivityLast30Days) {
    return {
      goal: "Claim missed bonus",
      blocker: "Bonus expired before being used",
      confidence: "medium",
      basedOn: [
        "webhookHistory.bonusExpiredUnusedInWindow",
        "webhookHistory.bonusExpiredWithinLast7Days",
        "webhookHistory.hasOtherActivityLast30Days",
      ],
    };
  }

  if (wh.registered && wh.totalDepositsEver === 0) {
    return {
      goal: "Complete first deposit",
      blocker: "No deposit made since registration",
      confidence: "medium",
      basedOn: ["webhookHistory.registered", "webhookHistory.totalDepositsEver"],
    };
  }

  return null;
}

// Tier 1 (CRM remark-based) is tried first, and only when player data is
// present. The most recent withdrawal/deposit (index 0 — the CRM returns
// these most-recent-first, confirmed against real recentWithdrawals
// payloads) is what "the current remark" means here. Falls through to
// Tier 2 whenever Tier 1 has nothing decisive to say — no CRM data, no
// remark, or a remark we don't recognize.
export function inferGoal(input: GoalInferenceInput): GoalInferenceResult | null {
  if (input.player) {
    const fromWithdrawal = classifyRemark(
      input.player.recentWithdrawals[0]?.remark,
      "recentWithdrawals[0].remark"
    );
    if (fromWithdrawal !== undefined) return fromWithdrawal;

    const fromDeposit = classifyRemark(
      input.player.recentDeposits[0]?.remark,
      "recentDeposits[0].remark"
    );
    if (fromDeposit !== undefined) return fromDeposit;
  }

  return inferTier2(input.webhookHistory);
}
