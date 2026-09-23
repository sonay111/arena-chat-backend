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

// pending_setup (added 2026-09-23) -- no real entry today has one nested
// inside a group (all 5 real pending_setup entries are standalone leaves
// with empty flows: []), so these are our own defensive assumption about
// what SHOULD happen if that ever changes, not validated against real
// aggregate data the way the unknown-handling tests above are.

test("aggregateStatus: pending_setup children are ignored once a definitive status exists, same as unknown", () => {
  assert.equal(aggregateStatus(["pending_setup", "pending_setup", "ok"]), "ok");
});

test("aggregateStatus: pending_setup children are ignored, a down child still wins", () => {
  assert.equal(aggregateStatus(["pending_setup", "delayed", "down"]), "down");
});

test("aggregateStatus: a mix of only unknown and pending_setup (no definitive status at all) aggregates to unknown", () => {
  assert.equal(aggregateStatus(["unknown", "pending_setup", "unknown"]), "unknown");
});

test("aggregateStatus: every child specifically pending_setup (no unknowns) aggregates to pending_setup, not a generic unknown", () => {
  assert.equal(aggregateStatus(["pending_setup", "pending_setup", "pending_setup"]), "pending_setup");
});

test("aggregateStatus: a single pending_setup child aggregates to pending_setup", () => {
  assert.equal(aggregateStatus(["pending_setup"]), "pending_setup");
});
