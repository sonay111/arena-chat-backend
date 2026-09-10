import { pool } from "./db.js";
import { getUsers, CrmApiError } from "./crm/index.js";
import { mapDialingCodeToCountry } from "./crm/dialing-code-to-country.js";
import { CATEGORIES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID } from "./activity/shared.js";

// Second-source backfill for players.country, on top of
// backfill-player-countries.ts (which only reads country from a real
// user.registered event). This one calls the CRM's getUsers() live and
// maps its countryCode (a phone dialing code, confirmed 2026-09-10 after
// Satyam's API update) through DIALING_CODE_TO_COUNTRY -- a genuinely
// different source, same target column. Only ever attempted for players
// who still have no country after the registration-event backfill ("if a
// country still isn't known any other way"); never overwrites a country
// already known from a real registration event.
//
// Same cohort definition used throughout src/activity/ and the earlier
// coverage investigation: every real (non-test) player id ever seen in
// any event type EXCEPT user.registered itself -- that's the "known real
// players" set this reports coverage against.
const NON_REGISTRATION_EVENT_TYPES = Object.entries(CATEGORIES)
  .filter(([category]) => category !== "registrations")
  .flatMap(([, eventTypes]) => eventTypes);

async function main() {
  const { rows: playerRows } = await pool.query(
    `SELECT DISTINCT user_id
     FROM raw_webhook_events
     WHERE event_name = ANY($1)
       AND user_id ~ $2
       AND user_id != $3
       AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
       AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'`,
    [NON_REGISTRATION_EVENT_TYPES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
  );
  const realPlayerIds: string[] = playerRows.map((r) => r.user_id);

  const { rows: beforeRows } = await pool.query(
    `SELECT count(*)::int AS n FROM players WHERE id = ANY($1) AND country IS NOT NULL`,
    [realPlayerIds]
  );
  const beforeCount = beforeRows[0].n;

  const { rows: knownRows } = await pool.query(
    `SELECT id FROM players WHERE id = ANY($1) AND country IS NOT NULL`,
    [realPlayerIds]
  );
  const alreadyKnown = new Set(knownRows.map((r) => r.id));
  const stillUnknown = realPlayerIds.filter((id) => !alreadyKnown.has(id));

  console.log(`Known real players (withdrawals/deposits/bonuses/bets/refreshes): ${realPlayerIds.length}`);
  console.log(`BEFORE: ${beforeCount}/${realPlayerIds.length} have a country on file.`);
  console.log(`Attempting to resolve via CRM countryCode for ${stillUnknown.length} players still missing one...\n`);

  let resolvedCount = 0;
  let crmFailedCount = 0;
  let unmappedCodeCount = 0;

  for (const userId of stillUnknown) {
    let countryCode: string | undefined;
    try {
      const { users } = await getUsers({ userId });
      const user = users.find((u) => u._id === userId);
      if (!user) {
        console.log(`  ${userId}: CRM returned no matching user`);
        crmFailedCount++;
        continue;
      }
      countryCode = user.countryCode;
    } catch (err) {
      const message = err instanceof CrmApiError ? `${err.name}: ${err.message}` : String(err);
      console.log(`  ${userId}: CRM lookup failed (${message})`);
      crmFailedCount++;
      continue;
    }

    if (!countryCode) {
      console.log(`  ${userId}: CRM returned no countryCode`);
      crmFailedCount++;
      continue;
    }

    const country = mapDialingCodeToCountry(countryCode);
    if (!country) {
      console.log(`  ${userId}: countryCode "${countryCode}" has no mapping — leaving as unknown`);
      unmappedCodeCount++;
      continue;
    }

    await pool.query(
      `INSERT INTO players (id, country) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET country = EXCLUDED.country, updated_at = now()`,
      [userId, country]
    );
    console.log(`  ${userId}: countryCode "${countryCode}" -> ${country}, saved`);
    resolvedCount++;
  }

  const { rows: afterRows } = await pool.query(
    `SELECT count(*)::int AS n FROM players WHERE id = ANY($1) AND country IS NOT NULL`,
    [realPlayerIds]
  );

  console.log(`\n=== Summary ===`);
  console.log(`BEFORE: ${beforeCount}/${realPlayerIds.length} known real players had a country on file.`);
  console.log(`Newly resolved via CRM countryCode this run: ${resolvedCount}`);
  console.log(`Still unresolved — CRM lookup failed / no countryCode: ${crmFailedCount}`);
  console.log(`Still unresolved — countryCode had no mapping: ${unmappedCodeCount}`);
  console.log(`AFTER: ${afterRows[0].n}/${realPlayerIds.length} known real players have a country on file.`);

  await pool.end();
}

main().catch((err) => {
  console.error("backfill-player-countries-via-crm failed:", err);
  process.exit(1);
});
