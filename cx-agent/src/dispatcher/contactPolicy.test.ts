import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDeferNewCase } from './contactPolicy.js';

const NOW = new Date('2026-10-02T10:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();
const convo = (category: string | null, messagedMinutesAgo: number | null) =>
  ({ category, agent_last_message_at: messagedMinutesAgo === null ? null : minutesAgo(messagedMinutesAgo) }) as never;
const isWithdrawal = (c: string | null | undefined) => c === 'withdrawal_delay' || c === 'withdrawal' || !c;

test('defers a new case when the customer was just messaged about a different kind of problem', () => {
  assert.equal(shouldDeferNewCase([convo('settlement_delay', 1)], isWithdrawal, NOW, 5), true);
});

test('does not defer once the cooldown has passed', () => {
  assert.equal(shouldDeferNewCase([convo('settlement_delay', 6)], isWithdrawal, NOW, 5), false);
});

test('never defers because of the SAME kind of problem (two delayed withdrawals behave as before)', () => {
  assert.equal(shouldDeferNewCase([convo('withdrawal_delay', 0.5)], isWithdrawal, NOW, 5), false);
  assert.equal(shouldDeferNewCase([convo('withdrawal', 0.5)], isWithdrawal, NOW, 5), false);
  assert.equal(shouldDeferNewCase([convo(null, 0.5)], isWithdrawal, NOW, 5), false);
});

test('ignores conversations the agent never messaged in', () => {
  assert.equal(shouldDeferNewCase([convo('settlement_delay', null)], isWithdrawal, NOW, 5), false);
});

test('a cooldown of 0 switches the rule off', () => {
  assert.equal(shouldDeferNewCase([convo('settlement_delay', 0)], isWithdrawal, NOW, 0), false);
});

test('one recent message about another kind is enough, among several conversations', () => {
  assert.equal(shouldDeferNewCase([convo('withdrawal_delay', 1), convo('kyc', 2)], isWithdrawal, NOW, 5), true);
});
