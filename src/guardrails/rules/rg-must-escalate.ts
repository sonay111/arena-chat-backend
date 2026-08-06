import type { Rule } from "../types.js";

const RULE_ID = "rg-must-escalate";

// FULLY ENFORCEABLE: this rule never reads the outbound content at all —
// it only checks a boolean signal that was already computed elsewhere
// (from responsible-gambling / self-exclusion flags on the player's
// account). There's no language to interpret, so there's nothing brittle
// about this one: the presence of the signal is unconditional grounds to
// block, full stop, no exceptions.
export const rgMustEscalateRule: Rule = {
  id: RULE_ID,
  description:
    "Blocks unconditionally, regardless of content, if the player's context carries any responsible-gambling or self-exclusion signal. No exceptions — always requires human handling.",
  evaluate(_claim, context) {
    if (context.responsibleGambling?.flagged) {
      const signals = context.responsibleGambling.signals?.length
        ? ` (${context.responsibleGambling.signals.join(", ")})`
        : "";
      return {
        passed: false,
        ruleId: RULE_ID,
        reason: `Player context carries a responsible-gambling / self-exclusion signal${signals} — must be escalated to a human, no automated content may be sent.`,
      };
    }
    return { passed: true, ruleId: RULE_ID };
  },
};
