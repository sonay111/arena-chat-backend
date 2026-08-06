import { test } from "node:test";
import assert from "node:assert/strict";
import { requireSuccessfulLookupRule } from "./require-successful-lookup.js";

test("passes when lookup status is success", () => {
  const result = requireSuccessfulLookupRule.evaluate(
    { content: "Your balance is ₹400." },
    { lookup: { status: "success" } }
  );
  assert.equal(result.passed, true);
});

test("blocks when lookup status is failed", () => {
  const result = requireSuccessfulLookupRule.evaluate(
    { content: "Your balance is ₹400." },
    { lookup: { status: "failed", reason: "CRM API timeout" } }
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.equal(result.ruleId, "require-successful-lookup");
    assert.match(result.reason, /failed/i);
    assert.match(result.reason, /CRM API timeout/);
  }
});

test("blocks when lookup status is missing", () => {
  const result = requireSuccessfulLookupRule.evaluate(
    { content: "Your balance is ₹400." },
    { lookup: { status: "missing" } }
  );
  assert.equal(result.passed, false);
});

test("blocks when lookup object itself is absent", () => {
  const result = requireSuccessfulLookupRule.evaluate(
    { content: "Your balance is ₹400." },
    {} as any
  );
  assert.equal(result.passed, false);
  if (!result.passed) {
    assert.match(result.reason, /missing/i);
  }
});
