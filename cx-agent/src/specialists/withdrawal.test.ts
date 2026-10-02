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

test('needsFirstMessage: true only for an open conversation that has never sent anything', async () => {
  const { needsFirstMessage } = await import('./withdrawal.js');
  const base = { status: 'autonomous', agent_last_message_at: null, pending_update_count: 0 } as never;
  assert.equal(needsFirstMessage(base), true);
  assert.equal(needsFirstMessage({ ...(base as object), status: 'monitoring' } as never), true);
});

test('needsFirstMessage: false once a message was sent, or when the conversation is resolved', async () => {
  const { needsFirstMessage } = await import('./withdrawal.js');
  const sent = { status: 'monitoring', agent_last_message_at: '2026-10-02T12:00:00.000Z', pending_update_count: 1 } as never;
  assert.equal(needsFirstMessage(sent), false);
  assert.equal(needsFirstMessage({ status: 'resolved', agent_last_message_at: null, pending_update_count: 0 } as never), false);
  assert.equal(needsFirstMessage({ status: 'autonomous', agent_last_message_at: null, pending_update_count: 2 } as never), false);
});
