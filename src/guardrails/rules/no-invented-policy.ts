import type { Rule, KnownPolicyFact } from "../types.js";

type PolicyType = KnownPolicyFact["type"];

type PatternDef = { type: PolicyType; regex: RegExp };

// Candidate patterns for policy-like assertions: timeframes, fees, limits,
// and general policy/rule language.
//
// PARTIALLY ENFORCEABLE — this is the most semantic rule in the whole
// layer. "Does this sentence assert a NEW policy fact" is a judgement
// about intent, not something regex resolves cleanly. These patterns will
// both miss creative paraphrases (an invented policy that doesn't match
// any pattern slips through) and occasionally flag ordinary sentences that
// happen to share vocabulary without asserting anything new. We
// deliberately bias toward over-flagging: a false positive costs an
// unnecessary human review; a false negative lets an invented policy reach
// a customer. See the guardrails README — this rule is a first-pass filter
// and belongs behind an AI verifier for real accuracy, especially for the
// non-numeric "policy" pattern below, which this file can only check for
// grounding by category, not by matching what's actually being asserted.
const PATTERNS: PatternDef[] = [
  { type: "timeframe", regex: /\b\d+\s*(-|to)\s*\d+\s*(business\s+)?(day|days|hour|hours|minute|minutes)\b/i },
  { type: "timeframe", regex: /\bwithin\s+\d+\s*(business\s+)?(day|days|hour|hours|minute|minutes)\b/i },
  { type: "timeframe", regex: /\b\d+\s*(business\s+)?(day|days|hour|hours|minute|minutes)\b/i },
  { type: "fee", regex: /\b\d+(\.\d+)?\s*%\s*(fee|charge|commission)\b/i },
  { type: "fee", regex: /\bfee of\s*(₹|rs\.?|inr|usd|usdt|\$)?\s*[\d,.]+/i },
  { type: "limit", regex: /\b(maximum|minimum|limit)\s+of\s*(₹|rs\.?|inr|usd|usdt|\$)?\s*[\d,.]+/i },
  { type: "limit", regex: /\bup to\s*(₹|rs\.?|inr|usd|usdt|\$)?\s*[\d,.]+/i },
  { type: "limit", regex: /\b(daily|weekly|monthly)\s+limit\b/i },
  { type: "policy", regex: /\byou (must|cannot|can't|are not allowed to|are required to)\b/i },
  { type: "policy", regex: /\bour policy (is|states)\b/i },
];

function numbersIn(text: string): string[] {
  return text.match(/\d+(\.\d+)?/g) ?? [];
}

// Numeric assertions (timeframe/fee/limit) are checked against the
// specific digits in known policy facts of the same type — a real,
// deterministic fact check. Non-numeric "policy" assertions ("you must
// verify...") can only be checked for whether SOME approved policy fact of
// that category exists, not whether this specific wording matches it —
// that gap is exactly why this rule needs an AI verifier behind it.
function isGrounded(assertionText: string, type: PolicyType, knownPolicies: KnownPolicyFact[]): boolean {
  const sameType = knownPolicies.filter((p) => p.type === type);
  if (sameType.length === 0) return false;

  const assertionNumbers = numbersIn(assertionText);
  if (assertionNumbers.length === 0) {
    return true;
  }

  return sameType.some((p) => {
    const policyNumbers = numbersIn(p.text);
    return assertionNumbers.every((n) => policyNumbers.includes(n));
  });
}

const RULE_ID = "no-invented-policy";

export const noInventedPolicyRule: Rule = {
  id: RULE_ID,
  description:
    "Blocks if the content asserts a policy, timeframe, fee, or limit not present in the supplied context.",
  evaluate(claim, context) {
    const knownPolicies = context.knownPolicies ?? [];
    const violations: string[] = [];

    for (const { type, regex } of PATTERNS) {
      const match = claim.content.match(regex);
      if (!match) continue;
      if (!isGrounded(match[0], type, knownPolicies)) {
        violations.push(match[0].trim());
      }
    }

    if (violations.length > 0) {
      return {
        passed: false,
        ruleId: RULE_ID,
        reason: `Content asserts polic${violations.length === 1 ? "y" : "ies"}/timeframe/fee/limit not grounded in supplied context: ${violations.map((v) => `"${v}"`).join(", ")}.`,
      };
    }

    return { passed: true, ruleId: RULE_ID };
  },
};
