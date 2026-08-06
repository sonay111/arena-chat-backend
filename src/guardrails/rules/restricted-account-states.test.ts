import { test } from "node:test";
import assert from "node:assert/strict";
import { restrictedAccountStatesRule } from "./restricted-account-states.js";
import type { ClaimContext } from "../types.js";

const base: ClaimContext = { lookup: { status: "success" } };

test("passes when the account has no restrictions at all", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "Your balance is ₹400." },
    { ...base, account: { isBlocked: false, withdrawalBlocked: false } }
  );
  assert.equal(result.passed, true);
});

test("passes when account field is entirely absent", () => {
  const result = restrictedAccountStatesRule.evaluate({ content: "Hi there!" }, base);
  assert.equal(result.passed, true);
});

test("blocks when account is blocked and content says nothing about it", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "Sure, happy to help with that." },
    { ...base, account: { isBlocked: true } }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.equal(result.ruleId, "restricted-account-states");
    assert.match(result.reason, /account is blocked/);
  }
});

test("passes when account is blocked and content acknowledges it", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "I can see your account is currently blocked, let me get a specialist to help." },
    { ...base, account: { isBlocked: true } }
  );
  assert.equal(result.passed, true);
});

test("blocks when withdrawals are blocked and content doesn't mention it", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "Let me check on that for you." },
    { ...base, account: { withdrawalBlocked: true } }
  );
  assert.equal(result.passed, false);
});

test("blocks when withdrawals are blocked even if content vaguely acknowledges restriction but still claims withdrawal progress", () => {
  const result = restrictedAccountStatesRule.evaluate(
    {
      content:
        "I see there's a restriction noted, but don't worry — your withdrawal is processing and on its way.",
    },
    { ...base, account: { withdrawalBlocked: true } }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /withdrawal is proceeding, paid, or complete/);
  }
});

test("passes when withdrawals are blocked, content acknowledges it, and makes no withdrawal-progress claim", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "Withdrawals are currently blocked on your account pending a review." },
    { ...base, account: { withdrawalBlocked: true } }
  );
  assert.equal(result.passed, true);
});

test("blocks when KYC is explicitly unverified and content doesn't mention it", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "Sure, I can help with your withdrawal request." },
    { ...base, account: { kycVerified: false } }
  );
  assert.equal(result.passed, false);
});

test("passes when KYC is explicitly unverified and content mentions verification", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "You'll need to verify your identity (KYC) before this can proceed." },
    { ...base, account: { kycVerified: false } }
  );
  assert.equal(result.passed, true);
});

test("does NOT treat kycVerified undefined as a restriction (not tracked in current data model)", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "Sure, happy to help." },
    { ...base, account: { isBlocked: false } } // kycVerified omitted entirely
  );
  assert.equal(result.passed, true);
});

test("lists multiple active restrictions in the reason when more than one applies", () => {
  const result = restrictedAccountStatesRule.evaluate(
    { content: "How can I help?" },
    { ...base, account: { isBlocked: true, withdrawalBlocked: true } }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /account is blocked/);
    assert.match(result.reason, /withdrawals are blocked/);
  }
});

test("KNOWN LIMITATION: presence of a disclosure word doesn't guarantee the disclosure is accurate or prominent", () => {
  // The word "blocked" appears, so the disclosure-presence check is
  // satisfied — even though this sentence uses it in an unrelated,
  // borderline-confusing way. This rule only checks presence of a fixed
  // phrase, not that it's the RIGHT explanation delivered clearly to the
  // customer. That judgement call needs a human or an AI verifier.
  const result = restrictedAccountStatesRule.evaluate(
    { content: "Your view was blocked by a pop-up, but here's your answer anyway!" },
    { ...base, account: { isBlocked: true } }
  );
  assert.equal(result.passed, true);
});
