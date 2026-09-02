import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db.js";
import { checkWithdrawalDelays } from "./withdrawal-delay-detector.js";
import type { PlayerContext } from "../crm/index.js";

// Real end-to-end tests against the actual dev Postgres (same convention as
// src/webhooks/webhooks.test.ts) — no mocked DB. The CRM API fetch IS
// stubbed though: real calls fail with CrmIpNotAllowedError until our
// server's IP is allowlisted (see src/crm/errors.ts), so a fake fetcher
// stands in and records how many times/with what userId it was called.

after(async () => {
  await pool.end();
});

// Real detector, shared dev DB, no per-test scoping on the candidate query
// (see checkWithdrawalDelays) — so if any other eligible withdrawal is
// sitting in the table when these tests run, this fetcher would get called
// for it too. Restricting to exactly the userIds these tests create means
// an unexpected call throws instead of silently "succeeding" and enriching
// a row this test didn't create — the detector's own "CRM failed, skip,
// leave unflagged" path handles that safely.
const KNOWN_TEST_USER_IDS = new Set([
  "TEST_USER_UNDER_10",
  "TEST_USER_OVER_10_PENDING",
  "TEST_USER_COMPLETED",
  "TEST_USER_NO_DOUBLE_FLAG",
]);

function fakePlayerContextFetcher() {
  const calls: Record<string, number> = {};
  const fetcher = async (userId: string): Promise<PlayerContext> => {
    calls[userId] = (calls[userId] ?? 0) + 1;
    if (!KNOWN_TEST_USER_IDS.has(userId)) {
      throw new Error(
        `fakePlayerContextFetcher called with unexpected userId "${userId}" — refusing to ` +
        `enrich a row this test didn't create (likely a real row picked up from the shared dev DB)`
      );
    }
    return {
      identity: { _id: userId, username: `fake_${userId}`, createdAt: "2026-01-01T00:00:00.000Z", is_blocked: false },
      recentDeposits: [],
      recentWithdrawals: [],
      activeBonuses: [],
    };
  };
  return { fetcher, calls };
}

async function insertTestWithdrawal(id: string, userId: string, status: string, minutesAgo: number) {
  await pool.query(
    `INSERT INTO payments (id, user_id, payment_type, status, amount, currency, created_at, updated_at)
     VALUES ($1, $2, 'withdrawal', $3, 100, 'INR', now() - ($4 * INTERVAL '1 minute'), now())`,
    [id, userId, status, minutesAgo]
  );
}

async function cleanupWithdrawal(id: string) {
  await pool.query("DELETE FROM withdrawal_delay_alerts WHERE payment_id = $1", [id]);
  await pool.query("DELETE FROM payments WHERE id = $1", [id]);
}

test("a withdrawal under 10 minutes old is not flagged", async () => {
  const id = "test_wd_under_10";
  const userId = "TEST_USER_UNDER_10";
  await insertTestWithdrawal(id, userId, "progress", 5);
  const { fetcher } = fakePlayerContextFetcher();

  await checkWithdrawalDelays(fetcher);

  const { rows } = await pool.query("SELECT flagged_delayed FROM payments WHERE id = $1", [id]);
  assert.equal(rows[0].flagged_delayed, false);

  const alert = await pool.query("SELECT 1 FROM withdrawal_delay_alerts WHERE payment_id = $1", [id]);
  assert.equal(alert.rowCount, 0);

  await cleanupWithdrawal(id);
});

test("a withdrawal over 10 minutes old and still pending is flagged, with player data attached", async () => {
  const id = "test_wd_over_10_pending";
  const userId = "TEST_USER_OVER_10_PENDING";
  await insertTestWithdrawal(id, userId, "progress", 15);
  const { fetcher, calls } = fakePlayerContextFetcher();

  const alerts = await checkWithdrawalDelays(fetcher);

  assert.equal(calls[userId], 1);
  const alert = alerts.find((a) => a.paymentId === id);
  assert.ok(alert, "expected an alert for the newly-flagged withdrawal");
  assert.equal(alert!.player.identity?._id, userId);

  const { rows } = await pool.query("SELECT flagged_delayed FROM payments WHERE id = $1", [id]);
  assert.equal(rows[0].flagged_delayed, true);

  const stored = await pool.query("SELECT player_context FROM withdrawal_delay_alerts WHERE payment_id = $1", [id]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].player_context.identity._id, userId);

  await cleanupWithdrawal(id);
});

test("a withdrawal that completed in time is never flagged", async () => {
  const id = "test_wd_completed";
  const userId = "TEST_USER_COMPLETED";
  // Old enough to qualify on time alone, but status is 'completed'.
  await insertTestWithdrawal(id, userId, "completed", 20);
  const { fetcher, calls } = fakePlayerContextFetcher();

  await checkWithdrawalDelays(fetcher);

  assert.equal(calls[userId], undefined);

  const { rows } = await pool.query("SELECT flagged_delayed FROM payments WHERE id = $1", [id]);
  assert.equal(rows[0].flagged_delayed, false);

  const alert = await pool.query("SELECT 1 FROM withdrawal_delay_alerts WHERE payment_id = $1", [id]);
  assert.equal(alert.rowCount, 0);

  await cleanupWithdrawal(id);
});

test("a withdrawal is never flagged or alerted twice", async () => {
  const id = "test_wd_no_double_flag";
  const userId = "TEST_USER_NO_DOUBLE_FLAG";
  await insertTestWithdrawal(id, userId, "progress", 15);
  const { fetcher, calls } = fakePlayerContextFetcher();

  const firstRun = await checkWithdrawalDelays(fetcher);
  const secondRun = await checkWithdrawalDelays(fetcher);

  assert.ok(firstRun.some((a) => a.paymentId === id));
  assert.ok(!secondRun.some((a) => a.paymentId === id));
  assert.equal(calls[userId], 1);

  const alertCount = await pool.query(
    "SELECT count(*)::int AS count FROM withdrawal_delay_alerts WHERE payment_id = $1",
    [id]
  );
  assert.equal(alertCount.rows[0].count, 1);

  await cleanupWithdrawal(id);
});
