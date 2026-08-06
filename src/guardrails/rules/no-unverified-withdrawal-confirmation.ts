import type { Rule } from "../types.js";
import { claimsWithdrawalCompletion } from "../lib/withdrawal-claims.js";

const RULE_ID = "no-unverified-withdrawal-confirmation";

// PARTIALLY ENFORCEABLE: detecting whether the content claims completion
// relies on the phrase-pattern heuristic in lib/withdrawal-claims.ts, which
// is honest about missing paraphrases. The fact-check half — does any
// withdrawal in context actually have status "completed"? — is fully
// deterministic. See the guardrails README for why the phrase-detection
// half needs an AI verifier to close the paraphrase gap.
export const noUnverifiedWithdrawalConfirmationRule: Rule = {
  id: RULE_ID,
  description:
    "Blocks if the content states or implies a withdrawal is complete/paid/sent, unless context shows a withdrawal's status is literally \"completed\".",
  evaluate(claim, context) {
    if (!claimsWithdrawalCompletion(claim.content)) {
      return { passed: true, ruleId: RULE_ID };
    }

    const hasCompletedWithdrawal = (context.withdrawals ?? []).some(
      (w) => w.status.trim().toLowerCase() === "completed"
    );

    if (!hasCompletedWithdrawal) {
      return {
        passed: false,
        ruleId: RULE_ID,
        reason:
          'Content states or implies a withdrawal is complete/paid/sent, but no withdrawal in context has a status of exactly "completed".',
      };
    }

    return { passed: true, ruleId: RULE_ID };
  },
};
