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
      return "Bet settled";
    case "casino.session_settled":
      return "Casino session settled";
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
