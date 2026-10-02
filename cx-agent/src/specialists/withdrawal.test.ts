import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

test('the withdrawal specialist owns the categories existing conversations actually have', async () => {
  const { withdrawalSpecialist } = await import('./withdrawal.js');
  assert.equal(withdrawalSpecialist.name, 'withdrawal');
  assert.equal(withdrawalSpecialist.caseType, 'withdrawal_delay');
  for (const category of ['withdrawal_delay', 'withdrawal', null, undefined]) {
    assert.equal(withdrawalSpecialist.handlesCategory(category), true, String(category));
  }
  assert.equal(withdrawalSpecialist.handlesCategory('settlement_delay'), false);
});

test('the agent runs the withdrawal specialist through the dispatcher', async () => {
  const { specialists } = await import('../orchestrator/poll.js');
  assert.deepEqual(specialists.map((s) => s.name), ['withdrawal']);
});
