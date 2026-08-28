import { pool } from "./db.js";

// Dev debugging tool: polls raw_webhook_events for new rows and prints them
// as they arrive. Polling, not LISTEN/NOTIFY, on purpose -- no schema/trigger
// changes needed, and this only ever needs to be "fast enough for a human
// watching a terminal," not real-time-system fast.
//
// Every webhook lands here BEFORE signature verification (see
// src/webhooks/envelope.ts), so this shows an event the instant it arrives,
// even if it later gets rejected as unsigned -- useful for exactly this
// case: confirming whether a triggered action reached us at all.
//
// Usage:
//   npm run tail:webhooks                # defaults to /withdrawals*
//   npm run tail:webhooks -- /deposits    # or any route prefix
//   npm run tail:webhooks -- /            # everything

const routePrefix = process.argv[2] ?? "/withdrawals";
const POLL_INTERVAL_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Tailing raw_webhook_events where route LIKE '${routePrefix}%' (polling every ${POLL_INTERVAL_MS}ms)...`);
  console.log("Ctrl+C to stop.\n");

  const { rows: initial } = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM raw_webhook_events");
  let lastSeenId: number = initial[0].max_id;

  while (true) {
    const { rows } = await pool.query(
      `SELECT id, route, event_name, event_id, user_id, received_at
       FROM raw_webhook_events
       WHERE id > $1 AND route LIKE $2
       ORDER BY id ASC`,
      [lastSeenId, `${routePrefix}%`]
    );

    for (const row of rows) {
      console.log(
        `[${row.received_at.toISOString()}] ${row.route}  event=${row.event_name ?? "(none)"}  eventId=${row.event_id ?? "(none)"}  user=${row.user_id ?? "(none)"}`
      );
      lastSeenId = row.id;
    }

    // Advance past non-matching rows too, so a burst of unrelated traffic
    // doesn't get re-scanned every poll.
    const { rows: latest } = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM raw_webhook_events");
    if (latest[0].max_id > lastSeenId && rows.length === 0) {
      lastSeenId = latest[0].max_id;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error("tail-webhook-events failed:", err);
  process.exit(1);
});
