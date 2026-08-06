import type { VerifiedAmount } from "../types.js";

// Matches a number adjacent to a currency marker, in either order:
// "₹400", "Rs. 400", "400 INR", "$50.25", "50 USDT", "1,200 rupees".
//
// LIMITATION: this only catches numerals with an adjacent currency marker.
// Spelled-out amounts ("four hundred rupees") won't be caught, and this is
// a fact-extraction check, not language understanding — it doesn't know
// what the number *means* (a balance vs. a deposit vs. an unrelated count),
// only that a currency-tagged number was stated. The content this layer
// checks is our own system's generated text, not arbitrary user input, so
// in practice it should consistently use a currency marker — but that's an
// assumption about how callers write prompts, not a guarantee.
const AMOUNT_PATTERN =
  /(?:₹|rs\.?|inr|usd|usdt|\$)\s?([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s?(?:₹|rs\.?|inr|usd|usdt|rupees|dollars)/gi;

export function extractAmounts(content: string): number[] {
  const amounts: number[] = [];
  for (const match of content.matchAll(AMOUNT_PATTERN)) {
    const raw = match[1] ?? match[2];
    if (raw) amounts.push(parseFloat(raw.replace(/,/g, "")));
  }
  return amounts;
}

const EPSILON = 0.01;

export function amountIsVerified(amount: number, verified: VerifiedAmount[]): boolean {
  return verified.some((v) => Math.abs(v.amount - amount) < EPSILON);
}
