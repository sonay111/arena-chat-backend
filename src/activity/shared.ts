import { describeEvent, getEventMeta } from "./describe.js";

// The routes that carry genuine platform activity worth showing in a feed.
// Deliberately explicit rather than "everything in raw_webhook_events" —
// that table also picked up junk from before the webhook-router path fix
// (src/webhooks/index.ts) and from malformed/test deliveries: unparsed
// envelopes, direct hits on bogus paths, etc. All of those have
// event_name IS NULL, which every query below excludes anyway, but this
// list is a second, independent line of defense against anything new
// landing in this table that isn't meant to be user-facing activity.
export const ACTIVITY_ROUTES = [
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
export const REAL_USER_ID_PATTERN = "^[0-9a-f]{24}$";
export const SYNTHETIC_USER_ID = "000000000000000000000001";

export type ActivityItem = {
  id: string;
  eventType: string;
  description: string;
  userId: string | null;
  timestamp: string;
  // Both bet-settlement-only extras (see describe.ts's getEventMeta) —
  // absent entirely for every other event type, not just undefined-valued:
  // JSON.stringify (what res.json() uses under the hood) drops
  // undefined-valued keys, so a non-bet item's response body never
  // contains an "outcome" or "tournamentName" key at all.
  outcome?: "won" | "lost";
  tournamentName?: string;
};

export function rowToItem(row: {
  id: string | number;
  event_name: string;
  user_id: string | null;
  payload: any;
  received_at: Date;
}): ActivityItem {
  const data = row.payload?.data ?? {};
  const { outcome, tournamentName } = getEventMeta(row.event_name, data);
  return {
    id: String(row.id),
    eventType: row.event_name,
    description: describeEvent(row.event_name, data),
    userId: row.user_id,
    timestamp: row.received_at.toISOString(),
    outcome,
    tournamentName,
  };
}

// Groupings for /activity/summary, and for filtering /activity/recent by a
// whole related family of event types at once (e.g. every withdrawal
// event, not just one specific one). user.blocked exists as a real event
// type (see CLAUDE.md's webhook list) but isn't part of any category here
// — it's rare enough, and different enough in nature from a "registration",
// that folding it into `registrations` would misrepresent the count.
export const CATEGORIES: Record<string, string[]> = {
  withdrawals: ["withdrawal.initiated", "withdrawal.completed", "withdrawal.status_updated"],
  deposits: ["deposit.completed", "deposit.initiated", "deposit.status_updated"],
  bonuses: ["bonus.activated", "bonus.expired"],
  bets: ["sportsbook.bet_settled", "casino.session_settled"],
  refreshes: ["player.refresh_detected"],
  registrations: ["user.registered"],
};
