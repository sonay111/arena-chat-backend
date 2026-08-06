import { test } from "node:test";
import assert from "node:assert/strict";
import { noUnverifiedWithdrawalConfirmationRule } from "./no-unverified-withdrawal-confirmation.js";
import type { ClaimContext } from "../types.js";

const base: ClaimContext = { lookup: { status: "success" } };

test("passes for content that makes no withdrawal claim at all", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "Thanks for reaching out, how can I help?" },
    base
  );
  assert.equal(result.passed, true);
});

test("passes for a progress claim (not a completion claim)", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "Your withdrawal is processing normally, about 9 minutes remaining." },
    { ...base, withdrawals: [{ id: "W1", status: "processing" }] }
  );
  assert.equal(result.passed, true);
});

test("blocks a completion claim when no withdrawal in context is completed", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "Your withdrawal has been completed and the funds have been sent." },
    { ...base, withdrawals: [{ id: "W1", status: "processing" }] }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.equal(result.ruleId, "no-unverified-withdrawal-confirmation");
  }
});

test("blocks a completion claim when there are no withdrawals in context at all", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "You have already received your money." },
    base
  );
  assert.equal(result.passed, false);
});

test("passes a completion claim when a withdrawal in context is literally completed", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "Good news — your withdrawal has been completed and paid." },
    { ...base, withdrawals: [{ id: "W1", status: "completed" }] }
  );
  assert.equal(result.passed, true);
});

test("status match is case-insensitive and trims whitespace", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "Your withdrawal was successful." },
    { ...base, withdrawals: [{ id: "W1", status: "  COMPLETED  " }] }
  );
  assert.equal(result.passed, true);
});

test("does not accept a near-miss status like 'completed_pending_review'", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "Your withdrawal was successful." },
    { ...base, withdrawals: [{ id: "W1", status: "completed_pending_review" }] }
  );
  assert.equal(result.passed, false);
});

test("blocks variant phrasing: money is in your account", () => {
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "The money is already in your account." },
    { ...base, withdrawals: [{ id: "W1", status: "processing" }] }
  );
  assert.equal(result.passed, false);
});

test("KNOWN LIMITATION: an unusual paraphrase can slip past the heuristic", () => {
  // This is the honest edge case: "all sorted on our end" implies
  // completion but matches none of our fixed phrase patterns, so it is
  // NOT caught. Documented here as a known gap, not a passing behavior we
  // endorse.
  const result = noUnverifiedWithdrawalConfirmationRule.evaluate(
    { content: "All sorted on our end for your withdrawal!" },
    { ...base, withdrawals: [{ id: "W1", status: "processing" }] }
  );
  assert.equal(result.passed, true);
});
