import "dotenv/config";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { applyMatchMessage, applyFeedStatus, getMatchId, getProducerKey } from "./state.js";
import type { MatchState, FeedStatus, OddsFeedEventName } from "./state.js";

// In-memory current state per match — NOT a message log. Each key is
// replaced wholesale on every applied update, never appended to, so this
// stays bounded by the number of live matches (tens to low hundreds),
// not by message volume (hundreds/minute).
export const matchStore = new Map<string, MatchState>();
export const feedStatusStore = new Map<string, FeedStatus>();

const MESSAGE_EVENTS: OddsFeedEventName[] = ["odds", "match_status", "bet_stop", "ended_match"];

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

let socket: Socket | undefined;

// Idempotent — safe to call once from server.ts. Connects and wires every
// handler; the actual subscribe happens inside the connect handler below,
// not here, since it must re-fire on every reconnect (see comment there).
export function startOddsFeed(): Socket {
  if (socket) return socket;

  const url = getEnv("ODDS_FEED_URL");
  const path = getEnv("ODDS_FEED_PATH");
  const token = getEnv("ODDS_FEED_TOKEN");

  socket = io(url, {
    path,
    transports: ["websocket"],
    auth: { token },
  });

  // Per the feed's own docs: the server does NOT remember subscriptions
  // across reconnects, so subscribe_all must be re-sent every time
  // connect fires, not just the first time — a dropped/restored
  // connection would otherwise silently go quiet forever.
  socket.on("connect", () => {
    console.log(`odds-feed: connected (socket.id=${socket?.id}), re-subscribing to all`);
    socket?.emit("subscribe_all");
  });

  socket.on("ready", (payload: any) => {
    if (payload?.limits?.allowAll !== true) {
      console.warn(
        "odds-feed: limits.allowAll is not true — subscribe_all may not cover the full feed",
        payload?.limits
      );
    }
  });

  for (const eventName of MESSAGE_EVENTS) {
    socket.on(eventName, (payload: any) => {
      const matchId = getMatchId(payload);
      if (!matchId) {
        console.warn(`odds-feed: ${eventName} message had no matchId, ignoring`, payload);
        return;
      }

      const result = applyMatchMessage(matchStore.get(matchId), matchId, eventName, payload);
      if (result.applied) {
        matchStore.set(matchId, result.state);
      }
    });
  }

  socket.on("feed_status", (payload: any) => {
    feedStatusStore.set(getProducerKey(payload), applyFeedStatus(payload));
  });

  socket.on("connect_error", (err: any) => {
    const code = err?.data?.code;
    if (code) {
      console.error(
        `odds-feed: connect_error — code=${code}` +
          (code === "IP_DENIED" ? " (our IP is not allowlisted for the odds feed)" : "")
      );
    } else {
      console.error(`odds-feed: connect_error — ${err?.message ?? err}`);
    }
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`odds-feed: disconnected (${reason})`);
  });

  return socket;
}

export function stopOddsFeed(): void {
  socket?.disconnect();
  socket = undefined;
}

// The most direct, always-available feed-health signal — feed_status
// itself has never actually arrived in real traffic yet (0 occurrences in
// every observation window so far), so a route relying on it alone would
// have nothing to report even while genuinely disconnected. Socket
// connection state is what GET /live-matches uses to tell "no live
// matches right now" apart from "the feed is down" (see routes.ts).
export function isOddsFeedConnected(): boolean {
  return socket?.connected ?? false;
}
