import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAmounts, amountIsVerified } from "./amounts.js";

test("extracts a rupee-symbol-prefixed amount", () => {
  assert.deepEqual(extractAmounts("Your balance is ₹400."), [400]);
});

test("extracts a suffixed currency amount", () => {
  assert.deepEqual(extractAmounts("You have 5.2 USDT available."), [5.2]);
});

test("extracts an amount with thousands separators", () => {
  assert.deepEqual(extractAmounts("Total: ₹1,200"), [1200]);
});

test("extracts multiple amounts from one string", () => {
  assert.deepEqual(extractAmounts("Deposit ₹100, balance ₹999."), [100, 999]);
});

test("returns an empty array when no currency-tagged number is present", () => {
  assert.deepEqual(extractAmounts("Hello there, how can I help?"), []);
});

test("does not extract a bare number with no currency marker", () => {
  assert.deepEqual(extractAmounts("Please wait about 400 seconds."), []);
});

test("amountIsVerified matches within floating point epsilon", () => {
  assert.equal(amountIsVerified(5.2, [{ amount: 5.2 }]), true);
});

test("amountIsVerified returns false when no match", () => {
  assert.equal(amountIsVerified(999, [{ amount: 100 }]), false);
});

test("amountIsVerified returns false against an empty list", () => {
  assert.equal(amountIsVerified(100, []), false);
});
