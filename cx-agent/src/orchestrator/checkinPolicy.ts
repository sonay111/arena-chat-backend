import { CHECKIN_INTERVAL_MINUTES, MAX_CHECKINS } from '../ai/drafts';

// When may the agent send an automatic "still pending" reminder, and what may it tell the
// customer about the next one? One place, so the reminders and the wording always agree.

/** True when a reminder is due: fewer than the maximum sent, and the interval has passed. */
export function shouldCheckIn(
  remindersSent: number,
  minutesSinceLastMessage: number,
  intervalMinutes: number = CHECKIN_INTERVAL_MINUTES,
  maxCheckins: number = MAX_CHECKINS
): boolean {
  return remindersSent < maxCheckins && minutesSinceLastMessage >= intervalMinutes;
}

/**
 * What to pass the AI as next_check_in_minutes. The agent may mention a next check only when one
 * will really happen: a number while reminders remain, null once the maximum has been reached.
 * remindersSent is the count INCLUDING any reminder being written right now.
 */
export function nextCheckInMinutes(
  remindersSent: number,
  intervalMinutes: number = CHECKIN_INTERVAL_MINUTES,
  maxCheckins: number = MAX_CHECKINS
): number | null {
  return remindersSent < maxCheckins ? intervalMinutes : null;
}
