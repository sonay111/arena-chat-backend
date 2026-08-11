import type { Rule } from "../types.js";
import { claimsWithdrawalCompletion } from "../lib/withdrawal-claims.js";

const RULE_ID = "no-unverified-withdrawal-confirmation";

// PARTIALLY ENFORCEABLE: detecting whether the content claims completion
// relies on the phrase-pattern heuristic in lib/withdrawal-claims.ts, which
// is honest about missing paraphrases. The fact-check half is deterministic
// but its evidence base is thin — see the note below.
//
// STILL UNCONFIRMED (2026-08): the platform's real .initiated payloads
// (from Satyam) showed a separate `payment_status` field alongside
// `status` — e.g. status: "progress" + payment_status: "pending" on the
// same record — that the original doc's one .status_updated example
// (status: "completed", no payment_status field at all) never showed. We
// have exactly two real examples, both mid-flight, and zero real examples
// of either field's value once a payment actually finishes. So:
//   - status === "completed" is kept as the primary signal — it's the one
//     value we have a real documented example of for a finished payment.
//   - payment_status === "pending" is treated as a defensive override that
//     blocks completion even if status claims "completed" — this is the
//     one payment_status value we have direct evidence for, and it
//     directly contradicts a completion claim.
//   - We do NOT check for any specific "success" payment_status value
//     (e.g. treating payment_status === "completed" as required or as
//     confirmatory) — we have never seen what that value actually is, and
//     guessing one would be exactly the false confidence this layer exists
//     to avoid. If payment_status is present and is anything other than
//     "pending", it is currently ignored, not validated.
// This needs a real .status_updated / completed example (ideally showing
// both fields together) from Satyam before this can be called solid.
export const noUnverifiedWithdrawalConfirmationRule: Rule = {
  id: RULE_ID,
  description:
    "Blocks if the content states or implies a withdrawal is complete/paid/sent, unless context shows a withdrawal's status is literally \"completed\" (and payment_status, if present, isn't \"pending\").",
  evaluate(claim, context) {
    if (!claimsWithdrawalCompletion(claim.content)) {
      return { passed: true, ruleId: RULE_ID };
    }

    const hasCompletedWithdrawal = (context.withdrawals ?? []).some((w) => {
      const statusCompleted = w.status.trim().toLowerCase() === "completed";
      if (!statusCompleted) return false;

      const stillPending = w.paymentStatus?.trim().toLowerCase() === "pending";
      return !stillPending;
    });

    if (!hasCompletedWithdrawal) {
      return {
        passed: false,
        ruleId: RULE_ID,
        reason:
          'Content states or implies a withdrawal is complete/paid/sent, but no withdrawal in context has status "completed" with a payment_status that isn\'t "pending".',
      };
    }

    return { passed: true, ruleId: RULE_ID };
  },
};
