import { pool } from "./db.js";

// One-off (but safely re-runnable) backfill for players.country. Needed
// because upsertPlayerFromRegistration didn't capture data.country until
// that column existed -- every player who registered before then has a
// players row missing country, even though the raw event that would tell
// us their country is still sitting in raw_webhook_events. Going forward,
// new user.registered events populate this automatically (see
// src/webhooks/players.ts) -- this script only needs to run once per
// environment to catch up on history.
//
// Same real-vs-test-data filter used throughout src/activity/: a real
// player id is always a 24-char hex Mongo ObjectId (every test fixture in
// this codebase uses a human-readable id instead, precisely so it can
// never collide with a real one), excluding the one hex-shaped synthetic
// id and any event_id starting with test_/tail_.
//
// ON CONFLICT only ever sets the country column -- never touches any
// other column on an existing players row, and never overwrites a real
// country value with something worse.
async function main() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (user_id) user_id, payload->'data'->>'country' AS country
     FROM raw_webhook_events
     WHERE event_name = 'user.registered'
       AND user_id ~ '^[0-9a-f]{24}$'
       AND user_id != '000000000000000000000001'
       AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
       AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'
       AND payload->'data'->>'country' IS NOT NULL
     ORDER BY user_id, received_at DESC`
  );

  console.log(`Found ${rows.length} distinct real players with a country value in a registration event.`);

  for (const row of rows) {
    await pool.query(
      `INSERT INTO players (id, country) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET country = EXCLUDED.country, updated_at = now()`,
      [row.user_id, row.country]
    );
  }

  console.log(`Backfilled country for ${rows.length} players.`);
  await pool.end();
}

main().catch((err) => {
  console.error("backfill-player-countries failed:", err);
  process.exit(1);
});
