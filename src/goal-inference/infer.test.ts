import { test } from "node:test";
import assert from "node:assert/strict";
import { inferGoal } from "./infer.js";
import type { GoalInferenceInput, GoalInferenceWebhookHistory } from "./infer.js";

// Baseline "nothing going on" webhook history — individual tests override
// only the fields relevant to what they're checking.
const QUIET_HISTORY: GoalInferenceWebhookHistory = {
  pendingWithdrawal: null,
  refreshIncidentsLastHour: 0,
  bonusExpiredUnusedInWindow: false,
  bonusExpiredWithinLast7Days: false,
  hasOtherActivityLast30Days: false,
  registered: true,
  totalDepositsEver: 3,
};

function withPlayerRemark(remark: string, on: "withdrawal" | "deposit" = "withdrawal"): GoalInferenceInput {
  return {
    player: {
      recentWithdrawals: on === "withdrawal" ? [{ status: "pending", remark }] : [],
      recentDeposits: on === "deposit" ? [{ status: "completed", remark }] : [],
    },
    webhookHistory: QUIET_HISTORY,
  };
}

// ===== Tier 1 — real remark examples from the live CRM data =====

test("Tier 1: 'Held for manual approval: user has sports bets' -> Receive withdrawal, high confidence", () => {
  const result = inferGoal(withPlayerRemark("Held for manual approval: user has sports bets"));
  assert.ok(result);
  assert.equal(result.goal, "Receive withdrawal");
  assert.equal(result.blocker, "Held for manual approval: user has sports bets");
  assert.equal(result.confidence, "high");
  assert.equal(result.safeBlocker, undefined);
  assert.deepEqual(result.basedOn, ["recentWithdrawals[0].remark"]);
});

test("Tier 1: 'Held for manual approval: Frogo verdict unavailable...' -> verbatim blocker + safe paraphrase", () => {
  const remark = "Held for manual approval: Frogo verdict unavailable (Frogo not configured)";
  const result = inferGoal(withPlayerRemark(remark));
  assert.ok(result);
  assert.equal(result.goal, "Receive withdrawal");
  assert.equal(result.blocker, remark);
  assert.equal(result.safeBlocker, "Held pending risk review");
  assert.equal(result.confidence, "high");
});

test("Tier 1: 'Rejected by admin' is resolved, not an active blocker -> null", () => {
  const result = inferGoal(withPlayerRemark("Rejected by admin"));
  assert.equal(result, null);
});

test("Tier 1: 'Approved by admin and submitted to Hero' is resolved -> null", () => {
  const result = inferGoal(withPlayerRemark("Approved by admin and submitted to Hero"));
  assert.equal(result, null);
});

test("Tier 1: 'Payelu payout initiated successfully' (a deposit remark) is resolved -> null", () => {
  const result = inferGoal(withPlayerRemark("Payelu payout initiated successfully", "deposit"));
  assert.equal(result, null);
});

test("Tier 1: remark containing 'test' is a known QA artifact -> excluded, null", () => {
  const result = inferGoal(withPlayerRemark("test"));
  assert.equal(result, null);
});

test("Tier 1: remark containing 'palig' is a known QA artifact -> excluded, null", () => {
  const result = inferGoal(withPlayerRemark("suspicious palig"));
  assert.equal(result, null);
});

test("Tier 1: remark containing 'suspect' is a known QA artifact -> excluded, null", () => {
  const result = inferGoal(withPlayerRemark("palig's ( suspect)"));
  assert.equal(result, null);
});

test("Tier 1: an unrecognized remark is not decisive -> falls through to Tier 2", () => {
  const input: GoalInferenceInput = {
    player: {
      recentWithdrawals: [{ status: "pending", remark: "Some future remark we've never seen" }],
      recentDeposits: [],
    },
    webhookHistory: { ...QUIET_HISTORY, pendingWithdrawal: { paymentId: "p1", amount: 50 } },
  };
  const result = inferGoal(input);
  assert.ok(result);
  assert.equal(result.goal, "Receive withdrawal");
  assert.equal(result.blocker, "Awaiting manual review");
  assert.equal(result.confidence, "medium");
});

// ===== Tier 2 — webhook-signal-only inference, one case per rule =====

test("Tier 2: pending withdrawal, no CRM remark (CRM-unresolved player) -> medium confidence", () => {
  const input: GoalInferenceInput = {
    player: null,
    webhookHistory: { ...QUIET_HISTORY, pendingWithdrawal: { paymentId: "p1", amount: 100 } },
  };
  const result = inferGoal(input);
  assert.ok(result);
  assert.equal(result.goal, "Receive withdrawal");
  assert.equal(result.blocker, "Awaiting manual review");
  assert.equal(result.confidence, "medium");
});

test("Tier 2: 2+ refresh incidents in the last hour, no pending withdrawal -> Checking account, low confidence", () => {
  const input: GoalInferenceInput = {
    player: null,
    webhookHistory: { ...QUIET_HISTORY, refreshIncidentsLastHour: 3 },
  };
  const result = inferGoal(input);
  assert.ok(result);
  assert.equal(result.goal, "Checking account");
  assert.equal(result.confidence, "low");
});

test("Tier 2: bonus expired unused, within 7 days, account still active in last 30 days -> Claim missed bonus, medium confidence", () => {
  const input: GoalInferenceInput = {
    player: null,
    webhookHistory: {
      ...QUIET_HISTORY,
      bonusExpiredUnusedInWindow: true,
      bonusExpiredWithinLast7Days: true,
      hasOtherActivityLast30Days: true,
    },
  };
  const result = inferGoal(input);
  assert.ok(result);
  assert.equal(result.goal, "Claim missed bonus");
  assert.equal(result.confidence, "medium");
});

test("Tier 2: bonus expired unused but more than 7 days ago -> does not fire (stale, not null-safe to assume active goal)", () => {
  const input: GoalInferenceInput = {
    player: null,
    webhookHistory: {
      ...QUIET_HISTORY,
      bonusExpiredUnusedInWindow: true,
      bonusExpiredWithinLast7Days: false,
      hasOtherActivityLast30Days: true,
    },
  };
  const result = inferGoal(input);
  assert.equal(result, null);
});

test("Tier 2: bonus expired within 7 days but account otherwise dormant (no activity in 30 days) -> does not fire", () => {
  const input: GoalInferenceInput = {
    player: null,
    webhookHistory: {
      ...QUIET_HISTORY,
      bonusExpiredUnusedInWindow: true,
      bonusExpiredWithinLast7Days: true,
      hasOtherActivityLast30Days: false,
    },
  };
  const result = inferGoal(input);
  assert.equal(result, null);
});

test("Tier 2: registered, zero deposits ever -> Complete first deposit, medium confidence", () => {
  const input: GoalInferenceInput = {
    player: null,
    webhookHistory: { ...QUIET_HISTORY, totalDepositsEver: 0 },
  };
  const result = inferGoal(input);
  assert.ok(result);
  assert.equal(result.goal, "Complete first deposit");
  assert.equal(result.confidence, "medium");
});

test("Tier 2: none of the signals apply -> null", () => {
  const input: GoalInferenceInput = { player: null, webhookHistory: QUIET_HISTORY };
  const result = inferGoal(input);
  assert.equal(result, null);
});

test("Tier 2: not registered and zero deposits does NOT trigger 'Complete first deposit'", () => {
  const input: GoalInferenceInput = {
    player: null,
    webhookHistory: { ...QUIET_HISTORY, registered: false, totalDepositsEver: 0 },
  };
  const result = inferGoal(input);
  assert.equal(result, null);
});
