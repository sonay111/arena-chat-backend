import type { Rule } from "../types.js";
import { rgMustEscalateRule } from "./rg-must-escalate.js";
import { requireSuccessfulLookupRule } from "./require-successful-lookup.js";
import { noUnverifiedWithdrawalConfirmationRule } from "./no-unverified-withdrawal-confirmation.js";
import { noUnverifiedAmountsRule } from "./no-unverified-amounts.js";
import { noPromisesRule } from "./no-promises.js";
import { noInventedPolicyRule } from "./no-invented-policy.js";
import { restrictedAccountStatesRule } from "./restricted-account-states.js";

export {
  rgMustEscalateRule,
  requireSuccessfulLookupRule,
  noUnverifiedWithdrawalConfirmationRule,
  noUnverifiedAmountsRule,
  noPromisesRule,
  noInventedPolicyRule,
  restrictedAccountStatesRule,
};

// Every rule, in the order they run. rg-must-escalate is listed first
// simply for readability — the runner has no short-circuiting, every rule
// always runs and every failure is collected (see runner.ts).
export const ALL_RULES: Rule[] = [
  rgMustEscalateRule,
  requireSuccessfulLookupRule,
  noUnverifiedWithdrawalConfirmationRule,
  noUnverifiedAmountsRule,
  noPromisesRule,
  noInventedPolicyRule,
  restrictedAccountStatesRule,
];
