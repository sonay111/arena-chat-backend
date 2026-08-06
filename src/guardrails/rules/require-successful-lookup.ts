import type { Rule } from "../types.js";

const RULE_ID = "require-successful-lookup";

// FULLY ENFORCEABLE: checks a status field the caller already computed
// (did the player-data lookup succeed?). No content interpretation
// involved — a claim generated from a failed or missing lookup is
// unconditionally ungrounded.
export const requireSuccessfulLookupRule: Rule = {
  id: RULE_ID,
  description:
    "Blocks if the player-data lookup that supposedly grounds this claim failed or is missing. We never make claims from nothing.",
  evaluate(_claim, context) {
    if (!context.lookup || context.lookup.status !== "success") {
      const status = context.lookup?.status ?? "missing";
      const reason = context.lookup?.reason ? ` (${context.lookup.reason})` : "";
      return {
        passed: false,
        ruleId: RULE_ID,
        reason: `Player-data lookup status is "${status}"${reason}, not "success" — no outbound claim may be made without a successful lookup.`,
      };
    }
    return { passed: true, ruleId: RULE_ID };
  },
};
