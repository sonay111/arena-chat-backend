import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { pool } from "../db.js";
import { createGoalInferenceRouter } from "./routes.js";
import type { PlayerContext } from "../crm/index.js";
import { CrmApiError } from "../crm/index.js";

// Real HTTP request against the actual router + real Postgres, same
// convention as src/alerts/routes.test.ts. The CRM call is stubbed (see
// createGoalInferenceRouter's injectable fetchPlayerContext) — real CRM
// calls depend on our server's IP being allowlisted, and this test only
// cares about the route's own logic, not the CRM client.

let baseUrl: string;
let server: http.Server;

const tier1UserId = "TEST_GOAL_TIER1_USER";
const tier2UserId = "TEST_GOAL_TIER2_USER";
const noInferenceUserId = "TEST_GOAL_NO_INFERENCE_USER";
const pendingPaymentId = "test_goal_tier2_pending";

// Stub fetcher: answers per test user id, throws CrmApiError for anything
// else (including the Tier 2 / no-inference ids — a CRM 404 is exactly how
// "unresolved" looks in production).
const fetcher = async (userId: string): Promise<PlayerContext> => {
  if (userId === tier1UserId) {
    return {
      identity: { _id: userId, username: "tier1_test_user", createdAt: "2026-01-01T00:00:00.000Z", is_blocked: false },
      recentDeposits: [],
      recentWithdrawals: [{ _id: "w1", userId, amount: 100, dateTime: "2026-09-16T00:00:00.000Z", status: "pending", remark: "Held for manual approval: user has sports bets" } as any],
      activeBonuses: [],
    };
  }
  throw new CrmApiError("User not found", 404);
};

before(async () => {
  const app = express();
  app.use(createGoalInferenceRouter(fetcher));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Tier 2 fixture: a genuinely pending withdrawal, no CRM data (fetcher
  // throws for this id) — buildWebhookHistory should still find it via
  // the payments table directly.
  await pool.query(
    `INSERT INTO payments (id, user_id, payment_type, status, amount, currency, created_at)
     VALUES ($1, $2, 'withdrawal', 'pending', 50, 'INR', now() - interval '5 minutes')`,
    [pendingPaymentId, tier2UserId]
  );
  // noInferenceUserId deliberately gets no fixtures at all — CRM
  // unresolved, and no webhook history rows to trigger any Tier 2 rule.
});

after(async () => {
  await pool.query("DELETE FROM payments WHERE id = $1", [pendingPaymentId]);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("GET /goal-inference/:playerId — Tier 1 (CRM-resolved, real remark) returns a high-confidence card", async () => {
  const res = await fetch(`${baseUrl}/goal-inference/${tier1UserId}`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.inference);
  assert.equal(body.inference.goal, "Receive withdrawal");
  assert.equal(body.inference.blocker, "Held for manual approval: user has sports bets");
  assert.equal(body.inference.confidence, "high");
  assert.deepEqual(body.inference.basedOn, ["recentWithdrawals[0].remark"]);
});

test("GET /goal-inference/:playerId — Tier 2 (CRM unresolved, pending withdrawal from our own webhook data) returns a medium-confidence card", async () => {
  const res = await fetch(`${baseUrl}/goal-inference/${tier2UserId}`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.inference);
  assert.equal(body.inference.goal, "Receive withdrawal");
  assert.equal(body.inference.blocker, "Awaiting manual review");
  assert.equal(body.inference.confidence, "medium");
});

test("GET /goal-inference/:playerId — nothing notable returns a clear empty response, not an error", async () => {
  const res = await fetch(`${baseUrl}/goal-inference/${noInferenceUserId}`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.deepEqual(body, { inference: null });
});
