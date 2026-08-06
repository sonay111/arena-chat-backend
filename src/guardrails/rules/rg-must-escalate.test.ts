import { test } from "node:test";
import assert from "node:assert/strict";
import { rgMustEscalateRule } from "./rg-must-escalate.js";
import type { ClaimContext } from "../types.js";

const baseContext: ClaimContext = { lookup: { status: "success" } };

test("passes when there is no responsible-gambling signal", () => {
  const result = rgMustEscalateRule.evaluate({ content: "Your balance is fine." }, baseContext);
  assert.equal(result.passed, true);
});

test("passes when responsibleGambling.flagged is explicitly false", () => {
  const result = rgMustEscalateRule.evaluate(
    { content: "Anything at all." },
    { ...baseContext, responsibleGambling: { flagged: false } }
  );
  assert.equal(result.passed, true);
});

test("blocks when flagged is true, regardless of content", () => {
  const result = rgMustEscalateRule.evaluate(
    { content: "Hi! Just a normal, harmless message." },
    { ...baseContext, responsibleGambling: { flagged: true } }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.equal(result.ruleId, "rg-must-escalate");
    assert.match(result.reason, /responsible-gambling/i);
  }
});

test("blocks even when content is empty", () => {
  const result = rgMustEscalateRule.evaluate(
    { content: "" },
    { ...baseContext, responsibleGambling: { flagged: true } }
  );
  assert.equal(result.passed, false);
});

test("includes specific signal names in the reason when provided", () => {
  const result = rgMustEscalateRule.evaluate(
    { content: "anything" },
    { ...baseContext, responsibleGambling: { flagged: true, signals: ["self_exclusion_active"] } }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /self_exclusion_active/);
  }
});
