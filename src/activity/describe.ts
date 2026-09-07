// Turns a raw webhook payload into a human-readable one-liner for the
// activity feed. Deliberately simple: amount+currency where the payload
// makes that easy and meaningful (deposits/withdrawals), a static label
// everywhere else. Real payload shapes confirmed against actual traffic
// (see src/activity/routes.test.ts and the CLAUDE.md webhook event list)
// — INR renders as a rupee symbol since every real INR amount we've seen
// is meant for a human, not a ledger; crypto currencies (usdttrc20, USDT)
// are shown as-is, uppercased, since there's no equivalent single-glyph
// symbol worth guessing at.
function formatAmount(amount: unknown, currency: unknown): string {
  const currencyStr = typeof currency === "string" ? currency.toUpperCase() : "";
  if (amount === null || amount === undefined) return currencyStr;
  if (currencyStr === "INR") return `₹${amount}`;
  return currencyStr ? `${amount} ${currencyStr}` : `${amount}`;
}

// "Withdrawal initiated — 5000 INR" when there's an amount worth showing;
// falls back to just the label if the payload has neither an amount nor a
// currency (malformed/unexpected data) — no dangling "— " with nothing
// after it.
function withAmount(label: string, amount: unknown, currency: unknown): string {
  const formatted = formatAmount(amount, currency);
  return formatted ? `${label} — ${formatted}` : label;
}

// returnAmount/stakeAmount arrive as JS floats computed upstream (e.g.
// 1.5999999999999996) — real sportsbook.bet_settled traffic confirmed this
// (see the investigation that led to this function). Round for display
// only; never used for anything that needs to add up exactly.
function round2(amount: unknown): unknown {
  return typeof amount === "number" ? Math.round(amount * 100) / 100 : amount;
}

function marketName(data: Record<string, unknown>): string | undefined {
  const info = data.eventMarketInformation;
  if (info && typeof info === "object" && "marketName" in info) {
    const name = (info as Record<string, unknown>).marketName;
    return typeof name === "string" && name.length > 0 ? name : undefined;
  }
  return undefined;
}

// "Bet won — 7.75 USDT returned (1st innings over 2 - 3rd delivery Mi Cape
// Town SRL total)" / "Bet lost — 2 USDT staked (Winner (incl. super
// over))". Deliberately uses returnAmount (won) / stakeAmount (lost), not
// winLossAmount — winLossAmount is itself a subtraction done upstream and
// inherits the same float imprecision, with no benefit over recomputing
// from the two source fields. marketName carries the actual bet
// detail — teamName is NOT used here: real traffic showed it holds a team
// name for one sport, a player's name for another, and the bet selection
// itself (e.g. "over 0.5") for a third — not reliable across sports.
function describeBetSettled(data: Record<string, unknown>): string {
  const market = marketName(data);
  const marketSuffix = market ? ` (${market})` : "";

  if (data.status === "won") {
    return `Bet won — ${formatAmount(round2(data.returnAmount), data.currency)} returned${marketSuffix}`;
  }
  if (data.status === "lost") {
    return `Bet lost — ${formatAmount(round2(data.stakeAmount), data.currency)} staked${marketSuffix}`;
  }
  // Any other/unknown status (e.g. void, cashout — never seen in real
  // traffic so far) falls back to the original plain label.
  return "Bet settled";
}

function gameName(data: Record<string, unknown>): string | undefined {
  return typeof data.gameName === "string" && data.gameName.length > 0 ? data.gameName : undefined;
}

// Same pattern as describeBetSettled, simpler payload: no nested
// eventMarketInformation, just a flat gameName ("spb_aviator") in its
// place. "Casino session won — 575 INR returned (spb_aviator)" / "Casino
// session lost — X staked (gameName)". Only "won" examples exist in real
// traffic so far (see the investigation this followed) — the "lost"
// branch is written defensively on the same status-field pattern bets
// use, unverified against a real example, and covered by a test anyway.
function describeCasinoSessionSettled(data: Record<string, unknown>): string {
  const game = gameName(data);
  const gameSuffix = game ? ` (${game})` : "";

  if (data.status === "won") {
    return `Casino session won — ${formatAmount(round2(data.returnAmount), data.currency)} returned${gameSuffix}`;
  }
  if (data.status === "lost") {
    return `Casino session lost — ${formatAmount(round2(data.stakeAmount), data.currency)} staked${gameSuffix}`;
  }
  return "Casino session settled";
}

// Fallback for an event name we don't have a specific case for yet (a new
// webhook type, or a documented-but-not-yet-seen one like
// casino.session_settled) — "deposit.initiated" -> "Deposit initiated",
// better than showing nothing or the raw dotted string.
function humanizeEventName(eventName: string): string {
  const withoutPrefix = eventName.split(".").join(" ");
  const spaced = withoutPrefix.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function describeEvent(eventName: string, data: Record<string, unknown>): string {
  switch (eventName) {
    case "user.registered":
      return "Player registered";
    case "user.blocked":
      return "Player blocked";
    case "deposit.completed":
      return withAmount("Deposit completed", data.amount, data.currency);
    case "deposit.initiated":
      return withAmount("Deposit initiated", data.amount, data.currency);
    case "deposit.status_updated":
      return withAmount("Deposit status updated", data.amount, data.currency);
    case "withdrawal.initiated":
      return withAmount("Withdrawal initiated", data.amount, data.currency);
    case "withdrawal.completed":
      return withAmount("Withdrawal completed", data.amount, data.currency);
    case "withdrawal.status_updated":
      return withAmount("Withdrawal status updated", data.amount, data.currency);
    case "sportsbook.bet_settled":
      return describeBetSettled(data);
    case "casino.session_settled":
      return describeCasinoSessionSettled(data);
    case "bonus.activated":
      return "Bonus activated";
    case "bonus.expired":
      return "Bonus expired";
    case "player.refresh_detected":
      return "Screen refresh detected";
    default:
      return humanizeEventName(eventName);
  }
}

// Structured extras for the activity item shape (see shared.ts's
// ActivityItem) that don't belong inside the description string itself —
// `outcome` lets the frontend color-code a settled bet/session without
// parsing text, `tournamentName` is meant as a secondary display line.
// Populated for sportsbook.bet_settled and casino.session_settled; every
// other event type gets {} (both fields absent, not just
// undefined-valued — see rowToItem). Casino sessions have no
// tournament/match equivalent in their payload (just a flat gameName,
// already used in the description itself) — tournamentName is
// deliberately left undefined there rather than repurposing gameProvider
// or gameName into it.
export function getEventMeta(
  eventName: string,
  data: Record<string, unknown>
): { outcome?: "won" | "lost"; tournamentName?: string } {
  if (eventName !== "sportsbook.bet_settled" && eventName !== "casino.session_settled") return {};

  const outcome = data.status === "won" || data.status === "lost" ? data.status : undefined;

  if (eventName === "casino.session_settled") {
    return { outcome };
  }

  const info = data.eventMarketInformation;
  const tournamentNameValue =
    info && typeof info === "object" && "tournamentName" in info
      ? (info as Record<string, unknown>).tournamentName
      : undefined;
  const tournamentName =
    typeof tournamentNameValue === "string" && tournamentNameValue.length > 0
      ? tournamentNameValue
      : undefined;

  return { outcome, tournamentName };
}
