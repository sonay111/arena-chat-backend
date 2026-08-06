import { test } from "node:test";
import assert from "node:assert/strict";
import { noPromisesRule } from "./no-promises.js";
import type { ClaimContext } from "../types.js";

const base: ClaimContext = { lookup: { status: "success" } };

test("passes for content with no compensation-related term", () => {
  const result = noPromisesRule.evaluate({ content: "Your withdrawal is processing normally." }, base);
  assert.equal(result.passed, true);
});

test("blocks an offer of goodwill compensation with no amount at all", () => {
  const result = noPromisesRule.evaluate(
    { content: "We'll waive the fee for you as a goodwill gesture." },
    base
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.equal(result.ruleId, "no-promises");
  }
});

test("blocks a promised refund with an amount that isn't verified in context", () => {
  const result = noPromisesRule.evaluate({ content: "We will refund you ₹500 for this." }, base);
  assert.equal(result.passed, false);
});

test("blocks a bonus offer even with an amount, when that amount isn't verified", () => {
  const result = noPromisesRule.evaluate(
    { content: "As an apology, here's a ₹200 bonus." },
    { ...base, verifiedAmounts: [{ amount: 50 }] }
  );
  assert.equal(result.passed, false);
});

test("passes when reporting an already-verified active bonus amount", () => {
  const result = noPromisesRule.evaluate(
    { content: "You currently have an active bonus of ₹100." },
    { ...base, verifiedAmounts: [{ amount: 100, label: "active_bonus" }] }
  );
  assert.equal(result.passed, true);
});

test("passes when reporting an already-verified, already-processed refund", () => {
  const result = noPromisesRule.evaluate(
    { content: "Your refund of ₹500 was processed on the 3rd." },
    { ...base, verifiedAmounts: [{ amount: 500, label: "refund" }] }
  );
  assert.equal(result.passed, true);
});

test("blocks cashback offer language", () => {
  const result = noPromisesRule.evaluate({ content: "You're eligible for cashback this week!" }, base);
  assert.equal(result.passed, false);
});

test("KNOWN LIMITATION: this rule cannot distinguish promise tense from fact tense by itself", () => {
  // "We will refund you ₹500" (a promise) and "we refunded you ₹500" (a
  // fact) both contain the same compensation word + verified amount, so
  // if the amount happens to be verified, BOTH pass under this rule's
  // amount-grounding heuristic — it cannot read tense. Documented
  // honestly: this is exactly the gap an AI verifier would need to close.
  const result = noPromisesRule.evaluate(
    { content: "We will refund you ₹500 for this, don't worry." },
    { ...base, verifiedAmounts: [{ amount: 500 }] }
  );
  assert.equal(result.passed, true);
});
