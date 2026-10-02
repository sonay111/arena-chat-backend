import type { ConversationState } from '../types';

// One rule about not overwhelming a customer who has several different problems at once.

function nonNegativeNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Minutes to wait before opening a NEW kind of problem with a customer we just messaged. 0 = off. */
export const CROSS_TYPE_COOLDOWN_MINUTES = nonNegativeNumberFromEnv('DISPATCH_CROSS_TYPE_COOLDOWN_MINUTES', 5);

/**
 * True when a new case should wait: the customer got an agent message within the cooldown about a
 * DIFFERENT kind of problem. Messages about the same kind are never delayed, so a customer with two
 * delayed withdrawals is handled exactly as before. A deferred case is not lost: it simply stays
 * new and is tried again on the next cycle.
 */
export function shouldDeferNewCase(
  customerConversations: ConversationState[],
  isSameKind: (category: string | null | undefined) => boolean,
  now: Date,
  cooldownMinutes: number = CROSS_TYPE_COOLDOWN_MINUTES
): boolean {
  if (cooldownMinutes <= 0) return false;
  return customerConversations.some((c) => {
    if (isSameKind(c.category)) return false;
    if (!c.agent_last_message_at) return false;
    const minutesAgo = (now.getTime() - new Date(c.agent_last_message_at).getTime()) / 60000;
    return minutesAgo < cooldownMinutes;
  });
}
