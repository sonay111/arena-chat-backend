import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyPendingWithdrawal, isPending } from "./notify";
import type { NotifyDeps, WithdrawalForNotice } from "./notify";

const ME = "aaaaaaaaaaaaaaaaaaaaaaa1";

function withdrawal(overrides: Partial<WithdrawalForNotice> = {}): WithdrawalForNotice {
  return {
    paymentId: "pay1",
    userId: ME,
    paymentType: "withdrawal",
    status: "pending",
    paymentStatus: null,
    gateway: "hero",
    username: "user_z7so3idw",
    ...overrides,
  };
}

// Returns deps plus a record of every send attempt, so tests can assert
// that nothing was sent when it shouldn't be.
function makeDeps(w: WithdrawalForNotice | null, overrides: Partial<NotifyDeps> = {}) {
  const sent: Array<{ userId: string; text: string }> = [];
  const deps: NotifyDeps = {
    loadWithdrawal: async () => w,
    send: async (userId, text) => {
      sent.push({ userId, text });
    },
    allowedPlayerIds: [ME],
    sendEnabled: false,
    ...overrides,
  };
  return { deps, sent };
}

test("isPending: true if either status field says pending", () => {
  assert.equal(isPending({ status: "pending", paymentStatus: null }), true);
  assert.equal(isPending({ status: "progress", paymentStatus: "pending" }), true);
  assert.equal(isPending({ status: "completed", paymentStatus: null }), false);
});

test("dry run (default): builds the message but sends nothing", async () => {
  const { deps, sent } = makeDeps(withdrawal());
  const result = await notifyPendingWithdrawal("pay1", deps);
  assert.equal(result.outcome, "dry_run");
  assert.equal(sent.length, 0);
  assert.match((result as { text: string }).text, /user_z7so3idw.*via hero.*pending/);
});

test("sends exactly once when sending is enabled", async () => {
  const { deps, sent } = makeDeps(withdrawal(), { sendEnabled: true });
  const result = await notifyPendingWithdrawal("pay1", deps);
  assert.equal(result.outcome, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, ME);
});

test("skips a player who is not on the allowlist, even with sending enabled", async () => {
  const { deps, sent } = makeDeps(withdrawal({ userId: "someone-else" }), { sendEnabled: true });
  const result = await notifyPendingWithdrawal("pay1", deps);
  assert.deepEqual(result, { outcome: "skipped", reason: "player not on the test allowlist" });
  assert.equal(sent.length, 0);
});

test("an empty allowlist means nobody is ever messaged", async () => {
  const { deps, sent } = makeDeps(withdrawal(), { allowedPlayerIds: [], sendEnabled: true });
  const result = await notifyPendingWithdrawal("pay1", deps);
  assert.equal(result.outcome, "skipped");
  assert.equal(sent.length, 0);
});

test("skips a withdrawal that is no longer pending", async () => {
  const { deps, sent } = makeDeps(withdrawal({ status: "completed" }), { sendEnabled: true });
  const result = await notifyPendingWithdrawal("pay1", deps);
  assert.equal(result.outcome, "skipped");
  assert.equal(sent.length, 0);
});

test("skips deposits, missing payments and unknown usernames", async () => {
  for (const w of [withdrawal({ paymentType: "deposit" }), null, withdrawal({ username: null })]) {
    const { deps, sent } = makeDeps(w, { sendEnabled: true });
    const result = await notifyPendingWithdrawal("pay1", deps);
    assert.equal(result.outcome, "skipped");
    assert.equal(sent.length, 0);
  }
});

test("a missing gateway still produces a clean message", async () => {
  const { deps } = makeDeps(withdrawal({ gateway: null }));
  const result = await notifyPendingWithdrawal("pay1", deps);
  assert.equal(result.outcome, "dry_run");
  assert.doesNotMatch((result as { text: string }).text, /via|null/);
});
