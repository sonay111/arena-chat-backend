import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateStatus } from "./aggregate.js";

test("aggregateStatus: all-unknown children aggregate to unknown", () => {
  assert.equal(aggregateStatus(["unknown", "unknown", "unknown"]), "unknown");
});

test("aggregateStatus: empty children aggregate to unknown", () => {
  assert.equal(aggregateStatus([]), "unknown");
});

test("aggregateStatus: unknown children are ignored once a definitive status exists (real rolezpay shape: unknown x4 + ok)", () => {
  assert.equal(aggregateStatus(["unknown", "unknown", "unknown", "unknown", "ok"]), "ok");
});

test("aggregateStatus: unknown children are ignored once a definitive status exists (real crm shape: unknown x3 + ok)", () => {
  assert.equal(aggregateStatus(["unknown", "ok", "unknown", "unknown"]), "ok");
});

test("aggregateStatus: down beats delayed and ok among definitive children", () => {
  assert.equal(aggregateStatus(["ok", "delayed", "down"]), "down");
});

test("aggregateStatus: delayed beats ok among definitive children (real pay777 shape: delayed, delayed, unknown)", () => {
  assert.equal(aggregateStatus(["delayed", "delayed", "unknown"]), "delayed");
});

test("aggregateStatus: a single ok child aggregates to ok", () => {
  assert.equal(aggregateStatus(["ok"]), "ok");
});

test("aggregateStatus: real dypaytech shape (delayed, unknown x4) aggregates to delayed", () => {
  assert.equal(aggregateStatus(["delayed", "unknown", "unknown", "unknown", "unknown"]), "delayed");
});
