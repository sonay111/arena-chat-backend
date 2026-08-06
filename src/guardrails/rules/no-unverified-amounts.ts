import type { Rule } from "../types.js";
import { extractAmounts, amountIsVerified } from "../lib/amounts.js";

const RULE_ID = "no-unverified-amounts";

// PARTIALLY ENFORCEABLE: the extraction half (lib/amounts.ts) is a
// currency-tagged-number regex, not language understanding — see the
// limitation note there. The verification half — does this number match
// something we actually retrieved? — is fully deterministic once a number
// is extracted.
export const noUnverifiedAmountsRule: Rule = {
  id: RULE_ID,
  description:
    "Blocks if the content states a balance or monetary amount that isn't present in successfully-retrieved context data.",
  evaluate(claim, context) {
    const stated = extractAmounts(claim.content);
    if (stated.length === 0) {
      return { passed: true, ruleId: RULE_ID };
    }

    const verified = context.verifiedAmounts ?? [];
    const unverified = stated.filter((amount) => !amountIsVerified(amount, verified));

    if (unverified.length > 0) {
      return {
        passed: false,
        ruleId: RULE_ID,
        reason: `Content states amount(s) [${unverified.join(", ")}] that do not match any value in the successfully-retrieved context data.`,
      };
    }

    return { passed: true, ruleId: RULE_ID };
  },
};
