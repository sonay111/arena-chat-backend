// The generic input this whole layer checks: any piece of text the system
// is about to show a customer — a chat reply, a proactive notification, a
// progress-tracker update — plus the context it was generated from. Not
// scoped to chat specifically, since notifications make the same kind of
// factual claims about a player's money and arguably need stricter
// checking (the customer never asked for them).
export type OutboundClaim = {
  content: string;
  // Free-form origin tag for the audit trail, e.g. "chat_reply",
  // "proactive_notification", "progress_tracker". Not used by any rule's
  // logic today — purely descriptive for logging/Training Center.
  channel?: string;
};

export type LookupStatus = "success" | "failed" | "missing";

export type WithdrawalRecord = {
  id?: string;
  // Raw status string as it comes from player-data (e.g. "completed",
  // "pending", "processing", "rejected"). Matched literally, case-insensitively.
  status: string;
};

export type VerifiedAmount = {
  amount: number;
  currency?: string;
  // Optional label for audit readability, e.g. "balance", "deposit_amount".
  label?: string;
};

export type KnownPolicyFact = {
  type: "timeframe" | "fee" | "limit" | "policy";
  // The approved fact's text, e.g. "3-5 business days", "2% fee",
  // "₹5,00,000 daily limit", "must complete KYC before withdrawing".
  text: string;
};

export type AccountState = {
  isBlocked?: boolean;
  withdrawalBlocked?: boolean;
  // false = explicitly not verified. undefined = unknown/not tracked yet
  // (the current player-data model has no KYC field — see README).
  kycVerified?: boolean;
};

export type ResponsibleGamblingSignal = {
  flagged: boolean;
  // e.g. ["self_exclusion_active", "rg_risk_flag"]
  signals?: string[];
};

// Everything a rule is allowed to know about when it was generated. This
// is deliberately a plain data bag, not a live lookup — rules never call
// out to the database or CRM themselves, they only see what the caller
// already retrieved.
export type ClaimContext = {
  lookup: {
    status: LookupStatus;
    reason?: string;
  };
  account?: AccountState;
  responsibleGambling?: ResponsibleGamblingSignal;
  withdrawals?: WithdrawalRecord[];
  verifiedAmounts?: VerifiedAmount[];
  knownPolicies?: KnownPolicyFact[];
};

export type RuleResult =
  | { passed: true; ruleId: string }
  | { passed: false; ruleId: string; reason: string };

export type Rule = {
  id: string;
  description: string;
  evaluate(claim: OutboundClaim, context: ClaimContext): RuleResult;
};

export type RuleFailure = {
  ruleId: string;
  reason: string;
};

export type Verdict = {
  passed: boolean;
  failures: RuleFailure[];
  results: RuleResult[];
};
