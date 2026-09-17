// Pure state-update logic for the odds feed — no socket, no I/O. The
// connection module (connection.ts) is the only caller; kept separate so
// this can be unit-tested without a live connection.

export type MatchState = {
  matchId: string;
  name?: string;
  sportId?: string;
  tournamentId?: string;
  tournamentName?: string;
  categoryName?: string;
  countryCode?: string;
  eventStatus?: string;
  scheduledTime?: string;
  bettingStopped?: boolean;
  ended?: boolean;
  // Which upstream producer this match's odds come from — cross-referenced
  // against feedStatusStore (see routes.ts) to tell whether this specific
  // match's data is currently trustworthy or potentially stale. Only ever
  // set from `odds` messages (the only event type that carries it in real
  // traffic); match_status/bet_stop/ended_match leave it as whatever it
  // already was.
  producerId?: string;
  // The domain `timestamp` (epoch ms) of the last message actually applied
  // for this match, if that message carried one. This — not _seq or
  // arrival order — is what the ordering rule below guards with.
  lastTimestamp?: number;
};

export type OddsFeedEventName = "odds" | "match_status" | "bet_stop" | "ended_match";

export type StatusTransition = {
  from: string;
  to: string;
};

export type ApplyResult = {
  applied: boolean;
  state: MatchState;
  // Only set when this message actually changed eventStatus from one real
  // value to a different one — not on a match's very first status (no
  // prior value to transition from) and not when the "new" status is the
  // same as what it already was. Lets the caller log just the transition
  // itself (see connection.ts + odds_status_transitions) without this
  // pure function needing to know anything about logging/DB.
  statusTransition?: StatusTransition;
};

// odds payloads carry their own doc id at `id` (the payload IS the match
// doc, same convention as the CRM webhooks' /users route); match_status
// and bet_stop instead carry `matchId` — confirmed against real traffic
// captured 2026-09-16. ended_match's shape hasn't been observed live yet
// (0 occurrences in a 2-minute sample), so both are checked defensively.
export function getMatchId(payload: any): string | undefined {
  return payload?.matchId ?? payload?.id;
}

// Real traffic showed `timestamp` present on odds messages but absent on
// match_status/bet_stop (which only carry matchId + a global `_seq`). A
// message with no domain timestamp has nothing to compare against, so it's
// always applied — withholding a status flip just because we can't verify
// its recency would be worse than occasionally applying one out of order.
// A message that DOES carry a timestamp is rejected only if it's strictly
// older than the last timestamp already applied for that match — this is
// what protects against the provider replaying older odds after a
// reconnect/recovery.
function isStale(current: MatchState | undefined, incomingTimestamp: number | undefined): boolean {
  if (incomingTimestamp === undefined) return false;
  if (current?.lastTimestamp === undefined) return false;
  return incomingTimestamp < current.lastTimestamp;
}

export function applyMatchMessage(
  current: MatchState | undefined,
  matchId: string,
  eventName: OddsFeedEventName,
  payload: any
): ApplyResult {
  const incomingTimestamp: number | undefined = payload?.timestamp;

  if (isStale(current, incomingTimestamp)) {
    return { applied: false, state: current! };
  }

  const base: MatchState = current ?? { matchId };
  let next: MatchState;

  switch (eventName) {
    case "odds":
      // Deliberately NOT copying payload.markets/outcomes — that's several
      // KB per match and the Tier-1 panel this state feeds only needs the
      // metadata + status below, not live prices.
      next = {
        ...base,
        matchId,
        name: payload.name ?? base.name,
        sportId: payload.sportId ?? base.sportId,
        tournamentId: payload.tournamentId ?? base.tournamentId,
        tournamentName: payload.tournamentName ?? base.tournamentName,
        categoryName: payload.categoryName ?? base.categoryName,
        countryCode: payload.countryCode ?? base.countryCode,
        eventStatus: payload.event_status ?? base.eventStatus,
        scheduledTime: payload.scheduledTime ?? base.scheduledTime,
        producerId: payload.producer_id !== undefined ? String(payload.producer_id) : base.producerId,
      };
      break;
    case "match_status":
      next = { ...base, matchId, eventStatus: payload.status ?? base.eventStatus };
      break;
    case "bet_stop":
      next = { ...base, matchId, bettingStopped: true };
      break;
    case "ended_match":
      next = { ...base, matchId, ended: true, eventStatus: payload.status ?? base.eventStatus };
      break;
  }

  if (incomingTimestamp !== undefined) {
    next.lastTimestamp = incomingTimestamp;
  }

  const statusTransition: StatusTransition | undefined =
    base.eventStatus !== undefined && next.eventStatus !== undefined && base.eventStatus !== next.eventStatus
      ? { from: base.eventStatus, to: next.eventStatus }
      : undefined;

  return { applied: true, state: next, statusTransition };
}

// feed_status is per-producer overall feed health, not per-match — tracked
// separately from MatchState entirely. Confirmed live 2026-09-17:
// { producer_id, connection: boolean }. Still preserves whatever arrives
// verbatim, keyed by producer, rather than hardcoding just that shape, in
// case other fields show up on other producers.
export type FeedStatus = {
  raw: unknown;
  receivedAt: number;
};

export function getProducerKey(payload: any): string {
  const producerId = payload?.producer_id ?? payload?.producerId;
  return producerId !== undefined ? String(producerId) : "default";
}

export function applyFeedStatus(payload: unknown): FeedStatus {
  return { raw: payload, receivedAt: Date.now() };
}
