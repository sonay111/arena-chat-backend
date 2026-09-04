import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { describeEvent } from "./describe.js";

export const activityRouter = Router();

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// The routes that carry genuine platform activity worth showing in a feed.
// Deliberately explicit rather than "everything in raw_webhook_events" —
// that table also picked up junk from before the webhook-router path fix
// (src/webhooks/index.ts) and from malformed/test deliveries: unparsed
// envelopes, direct hits on bogus paths, etc. All of those have
// event_name IS NULL, which the query below excludes anyway, but this
// list is a second, independent line of defense against anything new
// landing in this table that isn't meant to be user-facing activity.
const ACTIVITY_ROUTES = [
  "/users",
  "/deposits",
  "/deposits/status-update",
  "/withdrawals",
  "/withdrawals/status-update",
  "/sportsbook",
  "/casino",
  "/bonuses",
  "/alerts/refresh-detected",
];

// Real player/payment ids are always a 24-char hex Mongo ObjectId. Every
// test fixture in this codebase uses a human-readable id instead
// (TEST_PLAYER_X, TEST_USER_X, ...) precisely because that shape can
// never collide with a real one — so this regex is a robust, low-maintenance
// way to exclude test data without hardcoding every fixture prefix.
// 000000000000000000000001 is the one exception: a hex-shaped but
// deliberately synthetic id used by src/alerts/withdrawal-delay-detector.test.ts's
// dry-run script, excluded explicitly.
const REAL_USER_ID_PATTERN = "^[0-9a-f]{24}$";
const SYNTHETIC_USER_ID = "000000000000000000000001";

type ActivityItem = {
  id: string;
  eventType: string;
  description: string;
  userId: string | null;
  timestamp: string;
};

// GET /activity/recent?limit=30&before=<ISO timestamp>
// Cursor-paginated, newest first. `before` is the received_at of the last
// item from the previous page — pass it back to get the next one. No
// `before` means start from the newest event.
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

  try {
    // Fetch one extra row to know whether there's a next page, without a
    // separate COUNT query.
    const { rows } = await pool.query(
      `SELECT id, event_name, user_id, payload, received_at
       FROM raw_webhook_events
       WHERE event_name IS NOT NULL
         AND route = ANY($1)
         AND user_id ~ $2
         AND user_id != $3
         AND event_id NOT LIKE 'test\\_%' ESCAPE '\\'
         AND event_id NOT LIKE 'tail\\_%' ESCAPE '\\'
         AND ($4::timestamptz IS NULL OR received_at < $4)
       ORDER BY received_at DESC
       LIMIT $5`,
      [ACTIVITY_ROUTES, REAL_USER_ID_PATTERN, SYNTHETIC_USER_ID, before ?? null, limit + 1]
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items: ActivityItem[] = page.map((row) => ({
      id: String(row.id),
      eventType: row.event_name,
      description: describeEvent(row.event_name, row.payload?.data ?? {}),
      userId: row.user_id,
      timestamp: row.received_at.toISOString(),
    }));

    const nextCursor = hasMore ? page[page.length - 1].received_at.toISOString() : null;

    res.json({ items, nextCursor, hasMore });
  } catch (err) {
    console.error("GET /activity/recent failed:", err);
    res.status(500).json({ error: "failed to load recent activity", items: [] });
  }
});
