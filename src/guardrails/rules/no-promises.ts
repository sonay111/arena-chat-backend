import type { Rule } from "../types.js";
import { extractAmounts, amountIsVerified } from "../lib/amounts.js";

const RULE_ID = "no-promises";

const COMPENSATION_TERMS =
  /\b(refund|bonus|goodwill|compensation|reimburse(ment)?|voucher|cashback|complimentary)\b/i;

// PARTIALLY ENFORCEABLE, and the most conservative rule in this layer by
// design. Telling a PROMISE of future compensation apart from a factual
// statement about compensation that already happened ("we will refund
// you" vs. "your refund was processed on the 3rd") is a tense/intent
// judgement — regex can't reliably resolve that.
//
// Rather than guess at tense, this rule takes the safer position: ANY
// mention of a compensation-related term is blocked UNLESS the same
// content also states an amount that's already verified in context (i.e.
// it's reporting a real, already-recorded transaction, not offering a new
// one). This will over-block some legitimate factual mentions that lack a
// stated amount — that's an acceptable cost here (a human reviews) versus
// under-blocking an actual promise, which is not acceptable. Full accuracy
// on the promise/fact distinction needs an AI verifier — see the
// guardrails README.
export const noPromisesRule: Rule = {
  id: RULE_ID,
  description:
    "Blocks if the content promises a refund, bonus, goodwill payment, or compensation, unless it's reporting an already-verified transaction from context rather than offering a new one.",
  evaluate(claim, context) {
    if (!COMPENSATION_TERMS.test(claim.content)) {
      return { passed: true, ruleId: RULE_ID };
    }

    const stated = extractAmounts(claim.content);
    const verified = context.verifiedAmounts ?? [];
    const isGrounded = stated.length > 0 && stated.every((amount) => amountIsVerified(amount, verified));

    if (!isGrounded) {
      return {
        passed: false,
        ruleId: RULE_ID,
        reason:
          "Content mentions a refund/bonus/goodwill/compensation term without a matching amount already verified in context — treated as an unverified promise.",
      };
    }

    return { passed: true, ruleId: RULE_ID };
  },
};
