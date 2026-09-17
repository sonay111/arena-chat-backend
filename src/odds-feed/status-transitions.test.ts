import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db.js";
import { recordStatusTransition } from "./status-transitions.js";

// Non-hex id, same "obviously a test fixture" convention used throughout
// this codebase (e.g. src/alerts/routes.test.ts) -- this table has no
// real/synthetic filtering of its own to lean on, so cleanup here is by
// match_id rather than by excluding a pattern at query time.
const testMatchId = "TEST_STATUS_TRANSITION_MATCH";

after(async () => {
  await pool.query("DELETE FROM odds_status_transitions WHERE match_id = $1", [testMatchId]);
  await pool.end();
});

test("recordStatusTransition inserts a row with match_id, from_status, to_status, and a changed_at timestamp", async () => {
  await recordStatusTransition(testMatchId, "Live", "Suspended");

  const { rows } = await pool.query(
    `SELECT match_id, from_status, to_status, changed_at FROM odds_status_transitions WHERE match_id = $1`,
    [testMatchId]
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].match_id, testMatchId);
  assert.equal(rows[0].from_status, "Live");
  assert.equal(rows[0].to_status, "Suspended");
  assert.ok(rows[0].changed_at instanceof Date);
});

test("recordStatusTransition never writes markets/odds data -- only the 5 documented columns exist", async () => {
  await recordStatusTransition(testMatchId, "Suspended", "Live");

  const { rows } = await pool.query(
    `SELECT * FROM odds_status_transitions WHERE match_id = $1 ORDER BY changed_at DESC LIMIT 1`,
    [testMatchId]
  );

  assert.deepEqual(Object.keys(rows[0]).sort(), ["changed_at", "from_status", "id", "match_id", "to_status"]);
});
