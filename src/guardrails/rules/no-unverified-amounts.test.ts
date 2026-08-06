import { test } from "node:test";
import assert from "node:assert/strict";
import { noUnverifiedAmountsRule } from "./no-unverified-amounts.js";
import type { ClaimContext } from "../types.js";

const base: ClaimContext = { lookup: { status: "success" } };

test("passes for content with no monetary amount at all", () => {
  const result = noUnverifiedAmountsRule.evaluate({ content: "Hi, how can I help you today?" }, base);
  assert.equal(result.passed, true);
});

test("passes when the stated amount matches a verified amount (₹ prefix)", () => {
  const result = noUnverifiedAmountsRule.evaluate(
    { content: "Your balance is ₹400." },
    { ...base, verifiedAmounts: [{ amount: 400, currency: "INR", label: "balance" }] }
  );
  assert.equal(result.passed, true);
});

test("passes when the stated amount matches a verified amount (suffix currency word)", () => {
  const result = noUnverifiedAmountsRule.evaluate(
    { content: "You have 5.2 USDT available." },
    { ...base, verifiedAmounts: [{ amount: 5.2, currency: "USDT" }] }
  );
  assert.equal(result.passed, true);
});

test("passes when amount has thousands separators and matches", () => {
  const result = noUnverifiedAmountsRule.evaluate(
    { content: "Your deposit of ₹1,200 was received." },
    { ...base, verifiedAmounts: [{ amount: 1200 }] }
  );
  assert.equal(result.passed, true);
});

test("blocks when the stated amount has no matching verified value", () => {
  const result = noUnverifiedAmountsRule.evaluate(
    { content: "Your balance is ₹4000." },
    { ...base, verifiedAmounts: [{ amount: 400 }] }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.equal(result.ruleId, "no-unverified-amounts");
    assert.match(result.reason, /4000/);
  }
});

test("blocks when there are no verified amounts at all", () => {
  const result = noUnverifiedAmountsRule.evaluate({ content: "You'll get $50 back." }, base);
  assert.equal(result.passed, false);
});

test("blocks only the specific unverified amount among multiple stated", () => {
  const result = noUnverifiedAmountsRule.evaluate(
    { content: "You deposited ₹100 and your balance is ₹999." },
    { ...base, verifiedAmounts: [{ amount: 100 }] }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /999/);
    assert.doesNotMatch(result.reason, /\b100\b/);
  }
});

test("treats amounts within floating-point epsilon as matching", () => {
  const result = noUnverifiedAmountsRule.evaluate(
    { content: "Your balance is $5.2." },
    { ...base, verifiedAmounts: [{ amount: 5.2 }] }
  );
  assert.equal(result.passed, true);
});

test("KNOWN LIMITATION: a spelled-out amount is not extracted at all", () => {
  // "four hundred rupees" has no numeral+currency-marker pattern, so it
  // passes through unchecked. This is the documented limitation of the
  // extraction regex, not a false claim that this rule understands prose.
  const result = noUnverifiedAmountsRule.evaluate(
    { content: "Your balance is four hundred rupees." },
    { ...base, verifiedAmounts: [{ amount: 1 }] }
  );
  assert.equal(result.passed, true);
});
