// LIMITATION: whether a sentence claims a withdrawal is complete/paid/sent
// is a semantic judgement, not a fact check. These are deliberately
// conservative phrase patterns, not language understanding — they catch
// common phrasings but can miss creative paraphrases (false negative:
// an invented completion claim slips through) and, less often, misfire on
// unusual legitimate phrasing (false positive: gets blocked for human
// review unnecessarily). Treat this as a first-pass net. Closing the
// paraphrase gap reliably needs a second, AI-based verification pass —
// see the guardrails README.
const COMPLETION_PATTERNS: RegExp[] = [
  /\bwithdrawal\b[^.?!]{0,40}\b(is|has been|was)\b[^.?!]{0,20}\b(complete|completed|processed|paid|sent|successful)\b/i,
  /\b(money|funds|amount|cash)\b[^.?!]{0,40}\b(has been|have been|was|were)\b[^.?!]{0,20}\b(sent|paid|credited|transferred)\b/i,
  /\byou('| ha)ve (already )?(received|been paid|been credited)\b/i,
  /\b(successfully )?(withdrawn|paid you out)\b/i,
  /\bwithdrawal (is|has been) (done|finished)\b/i,
  /\bmoney is (already )?in your (account|wallet|bank)\b/i,
];

const PROGRESS_PATTERNS: RegExp[] = [
  /\bwithdrawal\b[^.?!]{0,40}\b(is|being)\b[^.?!]{0,20}\b(processing|progressing|underway|in progress)\b/i,
  /\bwithdrawal\b[^.?!]{0,20}\bon its way\b/i,
  /\bwithdrawal\b[^.?!]{0,20}\b(will arrive|expected|minutes remaining|remaining)\b/i,
];

export function claimsWithdrawalCompletion(content: string): boolean {
  return COMPLETION_PATTERNS.some((p) => p.test(content));
}

// Broader than completion: also true if the content merely says a
// withdrawal is underway. Used where ANY withdrawal activity claim is
// wrong (e.g. withdrawals are blocked on the account), not just a
// completion claim specifically.
export function claimsWithdrawalActivity(content: string): boolean {
  return claimsWithdrawalCompletion(content) || PROGRESS_PATTERNS.some((p) => p.test(content));
}
