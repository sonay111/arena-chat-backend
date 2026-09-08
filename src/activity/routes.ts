import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { ACTIVITY_ROUTES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID, CATEGORIES, rowToItem } from "./shared.js";
import type { ActivityItem } from "./shared.js";

export const activityRouter = Router();

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// Accepts ?eventType=withdrawal.initiated (single), ?eventType=a,b (comma-
// separated list on one param), or ?eventType=a&eventType=b (Express
// parses repeated query keys as an array) — all three end up as the same
// normalized list. No validation against a fixed enum: event_name is
// already free text (see describeEvent's fallback for unknown types), so
// an unrecognized value here just matches zero rows rather than erroring.
function parseEventTypes(raw: unknown): string[] | undefined {
  const values = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const flattened = values.flatMap((v) => String(v).split(","));
  const cleaned = flattened.map((v) => v.trim()).filter((v) => v.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

// "IN" matches players.country = 'IN' exactly; "unknown" (case-insensitive)
// matches a player with no country on file at all — same definition as
// /players/countries' unknownCount: no players row, or a players row with
// country IS NULL. No validation against a fixed list of real codes: an
// unrecognized code just matches zero rows, same philosophy as eventType.
function parseCountry(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.toLowerCase() === "unknown" ? "unknown" : trimmed.toUpperCase();
}

// GET /activity/recent?limit=30&before=<ISO timestamp>&eventType=withdrawal.initiated,withdrawal.completed&country=IN
// Cursor-paginated, newest first. `before` is the received_at of the last
// item from the previous page — pass it back to get the next one. No
// `before` means start from the newest event. `eventType` optionally
// restricts to one or more exact event names — pass a whole category's
// list (see CATEGORIES in shared.ts) to filter by a family of related
// events, e.g. every withdrawal event. `country` optionally restricts to
// a real country code, or the literal "unknown" — omitting it leaves
// every row unaffected by the LEFT JOIN below (it never drops rows on
// its own), so behavior with no `country` param is unchanged from before
// this filter existed.
activityRouter.get("/activity/recent", async (req: Request, res: Response) => {
  const limitParam = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  let before: Date | undefined;
  if (req.query.before !== undefined) {
    const parsed = new Date(String(req.query.before));
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "invalid 'before' cursor — must be a parseable timestamp" });
    }
    before = parsed;
  }

  const eventTypes = parseEventTypes(req.query.eventType);
  const country = parseCountry(req.query.country);

  try {
    // Fetch one extra row to know whether there's a next page, without a
    // separate COUNT query.
    const { rows } = await pool.query(
      `SELECT r.id, r.event_name, r.user_id, r.payload, r.received_at
       FROM raw_webhook_events r
       LEFT JOIN players p ON p.id = r.user_id
       WHERE r.event_name IS NOT NULL
         AND r.route = ANY($1)
         AND r.user_id ~ $2
         AND r.user_id != $3
         AND r.event_id NOT LIKE 'test\\_%' ESCAPE '\\'
         AND r.event_id NOT LIKE 'tail\\_%' ESCAPE '\\'
         AND ($4::timestamptz IS NULL OR r.received_at < $4)
         AND ($5::text[] IS NULL OR r.event_name = ANY($5))
         AND (
           $7::text IS NULL
           OR ($7 = 'unknown' AND p.country IS NULL)
           OR ($7 != 'unknown' AND p.country = $7)
         )
       ORDER BY r.received_at DESC
       LIMIT $6`,
      [ACTIVITY_ROUTES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID, before ?? null, eventTypes ?? null, limit + 1, country ?? null]
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items: ActivityItem[] = page.map(rowToItem);
    const nextCursor = hasMore ? page[page.length - 1].received_at.toISOString() : null;

    res.json({ items, nextCursor, hasMore });
  } catch (err) {
    console.error("GET /activity/recent failed:", err);
    res.status(500).json({ error: "failed to load recent activity", items: [] });
  }
});

// GET /activity/summary
// One row per category (see CATEGORIES in shared.ts): how many events of
// that category landed in the last 24 hours, and the single most recent
// one regardless of age. The two are intentionally on different time
// windows — count24h answers "how much just happened," mostRecent answers
// "what's the latest thing that happened at all," which stays useful even
// for a quiet category (count24h: 0 but mostRecent: something from days
// ago is more informative than mostRecent: null).
activityRouter.get("/activity/summary", async (_req: Request, res: Response) => {
  try {
    const categoryEntries = Object.entries(CATEGORIES);

    const results = await Promise.all(
      categoryEntries.map(async ([category, eventTypes]) => {
        const [countResult, mostRecentResult] = await Promise.all([
          pool.query(
            `SELECT count(*)::int AS count
             FROM raw_webhook_events
             WHERE event_name = ANY($1)
               AND route = ANY($2)
               AND user_id ~ $3
               AND user_id != $4
               AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
               AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'
               AND received_at > now() - interval '24 hours'
               AND received_at <= now()`,
            [eventTypes, ACTIVITY_ROUTES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
          ),
          pool.query(
            `SELECT id, event_name, user_id, payload, received_at
             FROM raw_webhook_events
             WHERE event_name = ANY($1)
               AND route = ANY($2)
               AND user_id ~ $3
               AND user_id != $4
               AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
               AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'
             ORDER BY received_at DESC
             LIMIT 1`,
            [eventTypes, ACTIVITY_ROUTES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID]
          ),
        ]);

        return [
          category,
          {
            count24h: countResult.rows[0].count,
            mostRecent: mostRecentResult.rows[0] ? rowToItem(mostRecentResult.rows[0]) : null,
          },
        ] as const;
      })
    );

    res.json({ categories: Object.fromEntries(results) });
  } catch (err) {
    console.error("GET /activity/summary failed:", err);
    res.status(500).json({ error: "failed to load activity summary", categories: {} });
  }
});
