import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { pool } from "../db.js";
import { playersRouter } from "./routes.js";

// Real HTTP request against the actual playersRouter + real Postgres,
// same convention as src/activity/routes.test.ts. This is a shared dev DB
// with real, ever-growing registration data already in it, so this test
// uses a baseline-then-delta approach (call once before inserting
// anything, call again after, assert the difference) rather than
// asserting absolute totals that would break the next time a real
// registration or webhook event arrives.

let baseUrl: string;
let server: http.Server;

// Valid-looking 24-char hex Mongo ObjectIds — must pass the same real-id
// filter the endpoint applies, or these test rows would just be silently
// excluded and prove nothing.
const KNOWN_COUNTRY_ID = "eeeeeeeeeeeeeeeeeeee0001";
const UNKNOWN_COUNTRY_ID = "eeeeeeeeeeeeeeeeeeee0002";
// ISO reserves "XX" for user-assigned/unknown use — chosen specifically
// because it should never collide with a real country code in this data.
const TEST_COUNTRY_CODE = "XX";

before(async () => {
  const app = express();
  app.use(playersRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await pool.query("DELETE FROM players WHERE id = ANY($1)", [[KNOWN_COUNTRY_ID, UNKNOWN_COUNTRY_ID]]);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("GET /players/countries: a new country appears with count 1, and unknownCount rises by exactly 1 for a countryless player", async () => {
  const before = await (await fetch(`${baseUrl}/players/countries`)).json();
  assert.ok(Array.isArray(before.countries));
  assert.equal(typeof before.unknownCount, "number");
  const baselineUnknown = before.unknownCount;
  assert.ok(
    !before.countries.some((c: any) => c.code === TEST_COUNTRY_CODE),
    "the test country code must not already exist in real data"
  );

  // One player with a brand-new country value, one with no country at all
  // (present in the players table, but nothing populated — simulating a
  // real player we know about with no registration event on file).
  await pool.query("INSERT INTO players (id, country) VALUES ($1, $2)", [KNOWN_COUNTRY_ID, TEST_COUNTRY_CODE]);
  await pool.query("INSERT INTO players (id, country) VALUES ($1, NULL)", [UNKNOWN_COUNTRY_ID]);

  const after = await (await fetch(`${baseUrl}/players/countries`)).json();

  const newEntry = after.countries.find((c: any) => c.code === TEST_COUNTRY_CODE);
  assert.ok(newEntry, "expected the new country code to appear");
  assert.equal(newEntry.count, 1);

  assert.equal(after.unknownCount, baselineUnknown + 1, "exactly one new countryless player should increase unknownCount by 1");
});

test("GET /players/countries: response shape matches { countries: [{code, count}], unknownCount }", async () => {
  const body = await (await fetch(`${baseUrl}/players/countries`)).json();
  assert.ok(Array.isArray(body.countries));
  for (const entry of body.countries) {
    assert.equal(typeof entry.code, "string");
    assert.equal(typeof entry.count, "number");
    assert.ok(entry.count > 0);
  }
  assert.equal(typeof body.unknownCount, "number");
  assert.ok(body.unknownCount >= 0);
});
