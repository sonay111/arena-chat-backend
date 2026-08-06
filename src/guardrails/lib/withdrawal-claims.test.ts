import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsWithdrawalCompletion, claimsWithdrawalActivity } from "./withdrawal-claims.js";

test("claimsWithdrawalCompletion: true for direct completion phrasing", () => {
  assert.equal(claimsWithdrawalCompletion("Your withdrawal has been completed."), true);
});

test("claimsWithdrawalCompletion: true for 'funds have been sent'", () => {
  assert.equal(claimsWithdrawalCompletion("The funds have been sent to your account."), true);
});

test("claimsWithdrawalCompletion: true for 'you have already received'", () => {
  assert.equal(claimsWithdrawalCompletion("You have already received your payout."), true);
});

test("claimsWithdrawalCompletion: false for a progress-only statement", () => {
  assert.equal(claimsWithdrawalCompletion("Your withdrawal is processing normally."), false);
});

test("claimsWithdrawalCompletion: false for unrelated content", () => {
  assert.equal(claimsWithdrawalCompletion("Thanks for your patience!"), false);
});

test("claimsWithdrawalActivity: true for a progress-only statement (broader than completion)", () => {
  assert.equal(claimsWithdrawalActivity("Your withdrawal is processing normally."), true);
});

test("claimsWithdrawalActivity: true for a completion statement too", () => {
  assert.equal(claimsWithdrawalActivity("Your withdrawal has been completed."), true);
});

test("claimsWithdrawalActivity: false for unrelated content", () => {
  assert.equal(claimsWithdrawalActivity("How can I help you today?"), false);
});
