import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuardrails } from "./runner.js";
import type { Rule, ClaimContext } from "./types.js";

const base: ClaimContext = { lookup: { status: "success" } };

const alwaysPass: Rule = {
  id: "always-pass",
  description: "test double",
  evaluate: () => ({ passed: true, ruleId: "always-pass" }),
};

const alwaysFailA: Rule = {
  id: "always-fail-a",
  description: "test double",
  evaluate: () => ({ passed: false, ruleId: "always-fail-a", reason: "reason A" }),
};

const alwaysFailB: Rule = {
  id: "always-fail-b",
  description: "test double",
  evaluate: () => ({ passed: false, ruleId: "always-fail-b", reason: "reason B" }),
};

test("passes overall when every rule passes", () => {
  const verdict = runGuardrails({ content: "hi" }, base, [alwaysPass, alwaysPass]);
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.results.length, 2);
});

test("fails overall when any rule fails", () => {
  const verdict = runGuardrails({ content: "hi" }, base, [alwaysPass, alwaysFailA]);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.failures.length, 1);
  assert.equal(verdict.failures[0].ruleId, "always-fail-a");
  assert.equal(verdict.failures[0].reason, "reason A");
});

test("collects EVERY failure, not just the first, in rule order", () => {
  const verdict = runGuardrails({ content: "hi" }, base, [alwaysFailA, alwaysPass, alwaysFailB]);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.failures.length, 2);
  assert.deepEqual(verdict.failures.map((f) => f.ruleId), ["always-fail-a", "always-fail-b"]);
});

test("results includes every rule's outcome, including passes, for the audit trail", () => {
  const verdict = runGuardrails({ content: "hi" }, base, [alwaysPass, alwaysFailA]);
  assert.equal(verdict.results.length, 2);
  assert.equal(verdict.results[0].passed, true);
  assert.equal(verdict.results[1].passed, false);
});

test("running with zero rules passes vacuously", () => {
  const verdict = runGuardrails({ content: "hi" }, base, []);
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.failures, []);
});
