import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

test('defaults are every 15 minutes, at most 3 reminders', async () => {
  const { CHECKIN_INTERVAL_MINUTES, MAX_CHECKINS } = await import('../ai/drafts.js');
  assert.equal(CHECKIN_INTERVAL_MINUTES, 15);
  assert.equal(MAX_CHECKINS, 3);
});

test('shouldCheckIn: not before the interval has passed', async () => {
  const { shouldCheckIn } = await import('./checkinPolicy.js');
  assert.equal(shouldCheckIn(0, 14.9, 15, 3), false);
  assert.equal(shouldCheckIn(0, 15, 15, 3), true);
  assert.equal(shouldCheckIn(1, 40, 15, 3), true);
});

test('shouldCheckIn: never after the maximum number of reminders, however long it has been', async () => {
  const { shouldCheckIn } = await import('./checkinPolicy.js');
  assert.equal(shouldCheckIn(2, 999, 15, 3), true); // third reminder still allowed
  assert.equal(shouldCheckIn(3, 999, 15, 3), false); // fourth is not
});

test('nextCheckInMinutes: promises a next check only while reminders remain', async () => {
  const { nextCheckInMinutes } = await import('./checkinPolicy.js');
  assert.equal(nextCheckInMinutes(0, 15, 3), 15); // first message: reminders will follow
  assert.equal(nextCheckInMinutes(2, 15, 3), 15); // two sent so far: a third is still to come
  assert.equal(nextCheckInMinutes(3, 15, 3), null); // after the third reminder: nothing more to promise
});

test('the last reminder promises no further check (count includes the reminder being written)', async () => {
  const { nextCheckInMinutes } = await import('./checkinPolicy.js');
  // maybeCheckin passes checkin_count + 1: writing reminder #3 happens at checkin_count = 2 -> 3
  assert.equal(nextCheckInMinutes(2 + 1, 15, 3), null);
  // writing reminder #2 happens at checkin_count = 1 -> 2: one more will follow
  assert.equal(nextCheckInMinutes(1 + 1, 15, 3), 15);
});
