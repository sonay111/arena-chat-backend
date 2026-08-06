import { test } from "node:test";
import assert from "node:assert/strict";
import { noInventedPolicyRule } from "./no-invented-policy.js";
import type { ClaimContext } from "../types.js";

const base: ClaimContext = { lookup: { status: "success" } };

test("passes for content with no policy-like assertion", () => {
  const result = noInventedPolicyRule.evaluate({ content: "Thanks for your patience!" }, base);
  assert.equal(result.passed, true);
});

test("blocks an invented timeframe with no matching known policy", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "Withdrawals usually take 3-5 business days." },
    base
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.equal(result.ruleId, "no-invented-policy");
    assert.match(result.reason, /3-5/);
  }
});

test("passes a timeframe that matches a known policy fact exactly", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "Withdrawals usually take 3-5 business days." },
    { ...base, knownPolicies: [{ type: "timeframe", text: "Standard withdrawal processing: 3-5 business days" }] }
  );
  assert.equal(result.passed, true);
});

test("blocks a timeframe whose numbers don't match the known policy's numbers", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "Withdrawals usually take 1-2 business days." },
    { ...base, knownPolicies: [{ type: "timeframe", text: "Standard withdrawal processing: 3-5 business days" }] }
  );
  assert.equal(result.passed, false);
});

test("blocks an invented fee percentage with no matching known policy", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "There is a 2% fee for that." },
    base
  );
  assert.equal(result.passed, false);
});

test("passes a fee that matches a known policy fact", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "There is a 2% fee for that." },
    { ...base, knownPolicies: [{ type: "fee", text: "Card withdrawal fee: 2%" }] }
  );
  assert.equal(result.passed, true);
});

test("blocks an invented limit with no matching known policy", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "There's a maximum of ₹500000 per day." },
    base
  );
  assert.equal(result.passed, false);
});

test("passes a limit that matches a known policy fact", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "There's a maximum of ₹500000 per day." },
    { ...base, knownPolicies: [{ type: "limit", text: "Daily withdrawal maximum of ₹500000" }] }
  );
  assert.equal(result.passed, true);
});

test("catches multiple violations in one message and lists all of them", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "Withdrawals take 3-5 business days and there's a 2% fee." },
    base
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /3-5/);
    assert.match(result.reason, /2%/);
  }
});

test("does not double-flag a fee already grounded while a separate unrelated timeframe is invented", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "There's a 2% fee, and withdrawals take 10-20 business days." },
    { ...base, knownPolicies: [{ type: "fee", text: "2% fee applies" }] }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /10-20/);
  }
});

test("KNOWN LIMITATION: non-numeric policy assertions are only checked by category, not by wording", () => {
  // Supplying ANY "policy" type fact is enough to pass a "you must ..."
  // assertion, even if the specific requirement it states is unrelated to
  // the supplied fact. This is the documented gap for non-numeric
  // assertions — closing it needs semantic comparison, i.e. an AI
  // verifier, not more regex.
  const result = noInventedPolicyRule.evaluate(
    { content: "You must submit a police report before we can process this." },
    { ...base, knownPolicies: [{ type: "policy", text: "Players must complete KYC before withdrawing" }] }
  );
  assert.equal(result.passed, true);
});

test("blocks a non-numeric policy assertion when no policy-type fact exists at all", () => {
  const result = noInventedPolicyRule.evaluate(
    { content: "You cannot withdraw more than once per day." },
    base
  );
  assert.equal(result.passed, false);
});
