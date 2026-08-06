import type { Rule, ClaimContext } from "../types.js";
import { claimsWithdrawalActivity } from "../lib/withdrawal-claims.js";

const RULE_ID = "restricted-account-states";

// Fixed phrase list for "does the content acknowledge SOME restricted
// state at all" — presence-of-phrase, not comprehension.
const DISCLOSURE_PATTERNS: RegExp[] = [
  /\bblock(ed)?\b/i,
  /\brestrict(ed|ion)?\b/i,
  /\bsuspend(ed)?\b/i,
  /\bon hold\b/i,
  /\bfrozen\b/i,
  /\bunder review\b/i,
  /\bverify your (identity|account|kyc)\b/i,
  /\bkyc\b/i,
  /\bcannot (withdraw|process|complete)\b/i,
  /\bunable to (withdraw|process|complete)\b/i,
];

type Restriction = { key: "isBlocked" | "withdrawalBlocked" | "kycVerified"; label: string };

function activeRestrictions(context: ClaimContext): Restriction[] {
  const account = context.account;
  if (!account) return [];
  const restrictions: Restriction[] = [];
  if (account.isBlocked) restrictions.push({ key: "isBlocked", label: "account is blocked" });
  if (account.withdrawalBlocked) restrictions.push({ key: "withdrawalBlocked", label: "withdrawals are blocked" });
  // Only an explicit `false` counts as a signal. `undefined` means "not
  // tracked" in the current player-data model (no KYC field exists yet
  // upstream — see src/webhooks/) — treated as "not applicable", not as a
  // restriction, so this doesn't fire on data we don't actually have.
  if (account.kycVerified === false) restrictions.push({ key: "kycVerified", label: "KYC is unverified" });
  return restrictions;
}

// PARTIALLY ENFORCEABLE. Detecting that a restriction is active is fully
// deterministic (plain boolean flags). What's checkable about the
// content is narrower than "reflects that state" in the full sense:
// (1) at least one disclosure phrase from a fixed list is present, and
// (2) if withdrawals are blocked, the content doesn't claim withdrawal
// activity is happening at all (reusing the same phrase heuristic as
// no-unverified-withdrawal-confirmation, with the same limitations).
// This cannot verify the disclosure is phrased *correctly*, prominently
// enough, or in a way a real customer would actually understand — that
// judgement call needs a human or an AI verifier. See the README.
export const restrictedAccountStatesRule: Rule = {
  id: RULE_ID,
  description:
    "If the account is blocked, withdrawal-blocked, or KYC-unverified, restricts what may be said and requires the content to acknowledge that state.",
  evaluate(claim, context) {
    const restrictions = activeRestrictions(context);
    if (restrictions.length === 0) {
      return { passed: true, ruleId: RULE_ID };
    }

    const hasDisclosure = DISCLOSURE_PATTERNS.some((p) => p.test(claim.content));
    if (!hasDisclosure) {
      return {
        passed: false,
        ruleId: RULE_ID,
        reason: `Account has active restriction(s) [${restrictions.map((r) => r.label).join(", ")}] but the content does not acknowledge any restricted state.`,
      };
    }

    const withdrawalBlocked = restrictions.some((r) => r.key === "withdrawalBlocked");
    if (withdrawalBlocked && claimsWithdrawalActivity(claim.content)) {
      return {
        passed: false,
        ruleId: RULE_ID,
        reason:
          "Withdrawals are blocked on this account, but the content states or implies a withdrawal is proceeding, paid, or complete.",
      };
    }

    return { passed: true, ruleId: RULE_ID };
  },
};
