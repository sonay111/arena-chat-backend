import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

const NOW = new Date('2026-10-02T15:00:00.000Z');
const at = (iso: string) => new Date(iso);
const msg = (id: string, createdAt: string, body = 'where is my money') => ({ id, body, createdAt });

test('selectCandidateMessages: keeps only messages after the conversation started, recent, oldest first', async () => {
  const { selectCandidateMessages } = await import('./catchUp.js');
  const start = at('2026-10-02T14:19:00.000Z');
  const result = selectCandidateMessages(
    [
      msg('late', '2026-10-02T14:40:00.000Z'),
      msg('before', '2026-10-02T10:34:00.000Z'), // earlier chat, not about this withdrawal
      msg('early', '2026-10-02T14:25:00.000Z'),
    ],
    start,
    NOW
  );
  assert.deepEqual(result.map((m) => m.id), ['early', 'late']);
});

test('selectCandidateMessages: ignores messages older than the age limit', async () => {
  const { selectCandidateMessages } = await import('./catchUp.js');
  const start = at('2026-09-30T00:00:00.000Z');
  const result = selectCandidateMessages([msg('old', '2026-10-01T10:00:00.000Z'), msg('new', '2026-10-02T14:00:00.000Z')], start, NOW, 24);
  assert.deepEqual(result.map((m) => m.id), ['new']);
});

function deps(over: Record<string, unknown> = {}) {
  const handled: Array<{ customerId: string; text: string; messageId?: string }> = [];
  const d = {
    listOpenConversations: async () => [{ customer_id: 'c1', first_seen_at: '2026-10-02T14:19:00.000Z' }],
    fetchCustomerMessages: async () => [msg('m1', '2026-10-02T14:31:04.000Z')],
    alreadyHandled: async () => false,
    handle: async (m: { customerId: string; text: string; messageId?: string }) => {
      handled.push(m);
    },
    canMessage: () => true,
    toSupportChatId: (id: string) => id,
    ...over,
  };
  return { d: d as never, handled };
}

test('runCatchUp: answers a customer message the agent had not handled, using the Support Chat id and messageId', async () => {
  const { runCatchUp } = await import('./catchUp.js');
  const { d, handled } = deps({ toSupportChatId: (id: string) => `sc-${id}` });
  const answered = await runCatchUp(d, NOW);
  assert.equal(answered, 1);
  assert.deepEqual(handled, [{ customerId: 'sc-c1', text: 'where is my money', messageId: 'm1' }]);
});

test('runCatchUp: skips a message that was already handled (by the forwarder or an earlier pass)', async () => {
  const { runCatchUp } = await import('./catchUp.js');
  const { d, handled } = deps({ alreadyHandled: async () => true });
  assert.equal(await runCatchUp(d, NOW), 0);
  assert.equal(handled.length, 0);
});

test('runCatchUp: never looks at a customer who may not be messaged', async () => {
  const { runCatchUp } = await import('./catchUp.js');
  let looked = 0;
  const { d, handled } = deps({
    canMessage: () => false,
    fetchCustomerMessages: async () => {
      looked++;
      return [msg('m1', '2026-10-02T14:31:04.000Z')];
    },
  });
  assert.equal(await runCatchUp(d, NOW), 0);
  assert.equal(looked, 0);
  assert.equal(handled.length, 0);
});

test('runCatchUp: a customer whose chat cannot be read does not stop the others', async () => {
  const { runCatchUp } = await import('./catchUp.js');
  const { d, handled } = deps({
    listOpenConversations: async () => [
      { customer_id: 'bad', first_seen_at: '2026-10-02T14:19:00.000Z' },
      { customer_id: 'good', first_seen_at: '2026-10-02T14:19:00.000Z' },
    ],
    fetchCustomerMessages: async (id: string) => {
      if (id === 'bad') throw new Error('Support Chat down');
      return [msg('m9', '2026-10-02T14:40:00.000Z')];
    },
  });
  assert.equal(await runCatchUp(d, NOW), 1);
  assert.deepEqual(handled.map((h) => h.customerId), ['good']);
});

test('runCatchUp: a customer with two open conversations is looked at once, from the earliest start', async () => {
  const { runCatchUp } = await import('./catchUp.js');
  let looks = 0;
  const { d, handled } = deps({
    listOpenConversations: async () => [
      { customer_id: 'c1', first_seen_at: '2026-10-02T14:30:00.000Z' },
      { customer_id: 'c1', first_seen_at: '2026-10-02T14:19:00.000Z' },
    ],
    fetchCustomerMessages: async () => {
      looks++;
      return [msg('m1', '2026-10-02T14:25:00.000Z')]; // after the earlier start, before the later one
    },
  });
  assert.equal(await runCatchUp(d, NOW), 1);
  assert.equal(looks, 1);
  assert.equal(handled.length, 1);
});

test('runCatchUp: answers at most 3 messages per customer in one pass', async () => {
  const { runCatchUp } = await import('./catchUp.js');
  const { d, handled } = deps({
    fetchCustomerMessages: async () => ['a', 'b', 'c', 'd', 'e'].map((id, i) => msg(id, `2026-10-02T14:3${i}:00.000Z`)),
  });
  assert.equal(await runCatchUp(d, NOW), 3);
  assert.deepEqual(handled.map((h) => h.messageId), ['a', 'b', 'c']); // oldest first
});

test('runCatchUp: a conversation with no start time is ignored (nothing to compare against)', async () => {
  const { runCatchUp } = await import('./catchUp.js');
  const { d } = deps({ listOpenConversations: async () => [{ customer_id: 'c1', first_seen_at: null }] });
  assert.equal(await runCatchUp(d, NOW), 0);
});
