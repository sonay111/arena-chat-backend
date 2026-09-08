import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { ACTIVITY_ROUTES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID, CATEGORIES } from "../activity/shared.js";

export const playersRouter = Router();

// Every real event type this backend tracks anywhere (see CATEGORIES in
// src/activity/shared.ts) — used below to find real players who don't
// have a players row at all, not just ones who do but lack a country.
const ALL_REAL_EVENT_TYPES = Object.values(CATEGORIES).flat();

// GET /players/countries
// { countries: [{ code, count }], unknownCount }
//
// countries is a plain group-by over players.country, populated at
// registration time (src/webhooks/players.ts) and backfilled once from
// history (src/backfill-player-countries.ts).
//
// unknownCount is NOT simply "players rows with country IS NULL" — most
// real, active players never generated a user.registered event we
// received at all (real deposit/withdrawal/bet/bonus payloads don't
// carry the nested user object the doc assumed, so they never create a
// players row that way either — see the investigation that led to this
// endpoint), so they have no players row whatsoever. unknownCount counts
// every real player id we've ever seen ANYWHERE — the players table plus
// every other real webhook event type — who doesn't have a country on
// file, not just the ones that happen to already have a players row.
playersRouter.get("/players/countries", async (_req: Request, res: Response) => {
  try {
    const { rows: countryRows } = await pool.query(
      `SELECT country AS code, count(*)::int AS count
       FROM players
       WHERE country IS NOT NULL
         AND id ~ $1
         AND id != $2
       GROUP BY country
       ORDER BY count DESC`,
      [REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
    );

    const { rows: universeRows } = await pool.query(
      `SELECT count(*)::int AS total FROM (
         SELECT id FROM players
         WHERE id ~ $3 AND id != $4
         UNION
         SELECT user_id AS id FROM raw_webhook_events
         WHERE event_name = ANY($1)
           AND route = ANY($2)
           AND user_id ~ $3
           AND user_id != $4
           AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
           AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'
       ) AS all_real_players`,
      [ALL_REAL_EVENT_TYPES, ACTIVITY_ROUTES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
    );

    const countries = countryRows.map((row) => ({ code: row.code, count: row.count }));
    const knownCountryTotal = countries.reduce((sum, row) => sum + row.count, 0);
    const unknownCount = universeRows[0].total - knownCountryTotal;

    res.json({ countries, unknownCount });
  } catch (err) {
    console.error("GET /players/countries failed:", err);
    res.status(500).json({ error: "failed to load player countries", countries: [], unknownCount: 0 });
  }
});
