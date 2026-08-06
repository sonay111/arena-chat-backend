import type { Rule, OutboundClaim, ClaimContext, Verdict } from "./types.js";

// Runs every rule independently and collects ALL failures, not just the
// first — the audit trail and the Training Center need to know every
// violation a piece of content triggered, not just whichever was checked
// first.
export function runGuardrails(claim: OutboundClaim, context: ClaimContext, rules: Rule[]): Verdict {
  const results = rules.map((rule) => rule.evaluate(claim, context));
  const failures = results
    .filter((r) => !r.passed)
    .map((r) => ({ ruleId: r.ruleId, reason: (r as { reason: string }).reason }));

  return {
    passed: failures.length === 0,
    failures,
    results,
  };
}
