import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPendingWithdrawalMessage } from "./message";

test("buildPendingWithdrawalMessage: includes username, status and gateway", () => {
  const text = buildPendingWithdrawalMessage({ username: "user_z7so3idw", status: "pending", gateway: "hero" });
  assert.match(text, /user_z7so3idw/);
  assert.match(text, /via hero/);
  assert.match(text, /is currently pending/);
});

test("buildPendingWithdrawalMessage: omits the gateway cleanly when it is null", () => {
  const text = buildPendingWithdrawalMessage({ username: "user_z7so3idw", status: "pending", gateway: null });
  assert.doesNotMatch(text, /via/);
  assert.doesNotMatch(text, /null|undefined/);
  assert.match(text, /your withdrawal is currently pending/);
});

test("buildPendingWithdrawalMessage: omits the gateway when it is missing or blank", () => {
  const missing = buildPendingWithdrawalMessage({ username: "u", status: "pending" });
  const blank = buildPendingWithdrawalMessage({ username: "u", status: "pending", gateway: "   " });
  assert.doesNotMatch(missing, /via/);
  assert.doesNotMatch(blank, /via/);
});
