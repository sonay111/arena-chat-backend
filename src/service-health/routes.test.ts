import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createServiceHealthRouter } from "./routes.js";
import type { RawServiceHealthResponse, NormalizedCategory } from "./types.js";

// Real HTTP request against the actual router, both dependencies stubbed
// (createServiceHealthRouter's injectable fetchRaw/fetchSportsbook) — same
// convention as goal-inference/routes.test.ts. No Postgres involved here,
// unlike that test, since this route doesn't touch our DB at all.

let baseUrl: string;
let server: http.Server;

const stubRaw: RawServiceHealthResponse = {
  status: true,
  checkedAt: "2026-09-22T04:14:15.614Z",
  summary: { total: 2, worst: "ok", ok: 2, delayed: 0, down: 0, unknown: 0 },
  data: [
    {
      service: "casino",
      key: "st8_casino_callbacks",
      label: "ST8 Casino Callbacks",
      category: "casino",
      method: "callback",
      status: "ok",
      lastSuccessAt: "2026-09-22T04:00:00.000Z",
      lastFailureAt: null,
      lastError: null,
      responseTimeMs: 144,
    },
    {
      service: "admin-api",
      key: "crm",
      label: "CRM & FastTrack",
      category: "crm",
      status: "ok",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      responseTimeMs: null,
      flows: [
        {
          key: "inbound_api",
          label: "CRM Inbound API",
          method: "inbound",
          status: "ok",
          lastSuccessAt: "2026-09-22T04:14:08.750Z",
          lastFailureAt: null,
          lastError: null,
          responseTimeMs: 26,
        },
      ],
    },
  ] as any,
};

const stubSportsbook: NormalizedCategory = {
  key: "sportsbook",
  label: "Sportsbook",
  status: "ok",
  realCoverage: "full",
  checks: [],
};

before(async () => {
  const app = express();
  app.use(
    createServiceHealthRouter(
      async () => stubRaw,
      async () => stubSportsbook
    )
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("GET /service-health returns all 8 categories with checkedAt passed through", async () => {
  const res = await fetch(`${baseUrl}/service-health`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.checkedAt, "2026-09-22T04:14:15.614Z");
  assert.deepEqual(
    body.categories.map((c: NormalizedCategory) => c.key),
    ["payments", "crm", "notifications", "casino", "sportsbook", "kyc_risk", "comms", "other"]
  );
});

test("GET /service-health: casino is real (ok, partial coverage), sportsbook wraps the injected stub as 'Our Connection' plus a 'Provider Health' row", async () => {
  const res = await fetch(`${baseUrl}/service-health`);
  const body = await res.json();

  const casino = body.categories.find((c: NormalizedCategory) => c.key === "casino");
  assert.equal(casino.status, "ok");
  assert.equal(casino.realCoverage, "partial");

  const sportsbook = body.categories.find((c: NormalizedCategory) => c.key === "sportsbook");
  assert.deepEqual(
    sportsbook.checks.map((c: { key: string }) => c.key),
    ["our_connection", "provider_health"]
  );
  const ourConnection = sportsbook.checks.find((c: { key: string }) => c.key === "our_connection");
  assert.deepEqual(ourConnection.children, stubSportsbook.checks, "the injected stub's own checks pass through untouched");
});

test("GET /service-health: a fetchRaw failure returns 500 rather than a partial/broken body", async () => {
  const app = express();
  app.use(
    createServiceHealthRouter(
      async () => {
        throw new Error("CRM /service-health unreachable");
      },
      async () => stubSportsbook
    )
  );
  const failingServer = http.createServer(app);
  await new Promise<void>((resolve) => failingServer.listen(0, resolve));
  const address = failingServer.address();
  if (typeof address !== "object" || address === null) throw new Error("failed to bind");
  const failingBaseUrl = `http://127.0.0.1:${address.port}`;

  const res = await fetch(`${failingBaseUrl}/service-health`);
  assert.equal(res.status, 500);

  await new Promise<void>((resolve, reject) => failingServer.close((err) => (err ? reject(err) : resolve())));
});
