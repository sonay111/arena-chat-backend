import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

type Calls = { opened: string[]; followed: Array<{ convo: string; current: string | undefined }> };

// A stand-in specialist that records what the dispatcher asks of it.
function fakeSpecialist(
  name: string,
  caseType: string,
  categories: string[],
  cases: Array<{ id: string; customerId?: string }>,
  over: Record<string, unknown> = {}
) {
  const calls: Calls = { opened: [], followed: [] };
  const specialist = {
    name,
    caseType,
    handlesCategory: (c: string | null | undefined) => categories.includes(c ?? ''),
    detect: async () => cases.map((c) => ({ id: c.id, type: caseType, customerId: c.customerId ?? 'cust', raw: c })),
    openCase: async (c: { id: string }) => {
      calls.opened.push(c.id);
    },
    followUp: async (convo: { payment_id: string }, current: { id: string } | undefined) => {
      calls.followed.push({ convo: convo.payment_id, current: current?.id });
    },
    ...over,
  };
  return { specialist: specialist as never, calls };
}

const convo = (paymentId: string, category: string | null, extra: Record<string, unknown> = {}) =>
  ({ conversation_id: `conv-${paymentId}`, payment_id: paymentId, category, customer_id: 'cust', ...extra }) as never;

function deps(conversations: unknown[], known: string[] = [], over: Record<string, unknown> = {}) {
  return {
    getConversations: async () => conversations,
    getKnownCaseIds: async (ids: string[]) => new Set(ids.filter((i) => known.includes(i))),
    getCustomerConversations: async () => [],
    crossTypeCooldownMinutes: 0,
    ...over,
  } as never;
}

const NOW = new Date('2026-10-02T10:00:00.000Z');

test('opens a new case once, and leaves a case it already knows alone', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const { specialist, calls } = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'new1' }, { id: 'old1' }]);
  await runDispatchCycle([specialist], NOW, deps([], ['old1']));
  assert.deepEqual(calls.opened, ['new1']);
});

test('follows up an existing conversation with the specialist that owns it, passing its current case', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const { specialist, calls } = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'p1' }]);
  await runDispatchCycle([specialist], NOW, deps([convo('p1', 'withdrawal_delay'), convo('p2', 'withdrawal_delay')], ['p1', 'p2']));
  assert.deepEqual(calls.followed, [
    { convo: 'p1', current: 'p1' }, // still reported
    { convo: 'p2', current: undefined }, // no longer reported
  ]);
});

test('each case and conversation goes to the right specialist', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const w = fakeSpecialist('withdrawal', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'w-new' }]);
  const s = fakeSpecialist('settlement', 'settlement_delay', ['settlement_delay'], [{ id: 's-new' }]);
  await runDispatchCycle([w.specialist, s.specialist], NOW, deps([convo('s-old', 'settlement_delay')], ['s-old']));
  assert.deepEqual(w.calls.opened, ['w-new']);
  assert.deepEqual(s.calls.opened, ['s-new']);
  assert.deepEqual(w.calls.followed, []);
  assert.deepEqual(s.calls.followed, [{ convo: 's-old', current: undefined }]);
});

test('a conversation nobody owns is left alone, without disturbing the others', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const { specialist, calls } = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], []);
  await runDispatchCycle([specialist], NOW, deps([convo('x1', 'mystery'), convo('p1', 'withdrawal_delay')], ['x1', 'p1']));
  assert.deepEqual(calls.followed.map((f) => f.convo), ['p1']);
});

test('if a specialist\'s signal cannot be read, it is skipped entirely: no follow-ups, no new cases (nothing wrongly marked resolved)', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const broken = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'n' }], {
    detect: async () => {
      throw new Error('feed down');
    },
  });
  const healthy = fakeSpecialist('s', 'settlement_delay', ['settlement_delay'], [{ id: 's-new' }]);
  await runDispatchCycle([broken.specialist, healthy.specialist], NOW, deps([convo('p1', 'withdrawal_delay')], ['p1']));
  assert.deepEqual(broken.calls.followed, []);
  assert.deepEqual(broken.calls.opened, []);
  assert.deepEqual(healthy.calls.opened, ['s-new']); // the other specialist still runs
});

test('a case that fails to open does not stop the next one; a failing follow-up does not stop the next one', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const seen: string[] = [];
  const specialist = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'bad' }, { id: 'good' }], {
    openCase: async (c: { id: string }) => {
      if (c.id === 'bad') throw new Error('boom');
      seen.push(`opened:${c.id}`);
    },
    followUp: async (cv: { payment_id: string }) => {
      if (cv.payment_id === 'a') throw new Error('boom');
      seen.push(`followed:${cv.payment_id}`);
    },
  }).specialist;
  await runDispatchCycle([specialist], NOW, deps([convo('a', 'withdrawal_delay'), convo('b', 'withdrawal_delay')], ['a', 'b']));
  assert.deepEqual(seen, ['followed:b', 'opened:good']);
});

test('contact rule: a new case is held when the customer was just messaged about a different kind of problem, then opened later', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const justNow = new Date(NOW.getTime() - 60_000).toISOString();
  const recentOther = [{ category: 'settlement_delay', agent_last_message_at: justNow }];
  const first = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'n1', customerId: 'c1' }]);
  await runDispatchCycle([first.specialist], NOW, deps([], [], { crossTypeCooldownMinutes: 5, getCustomerConversations: async () => recentOther }));
  assert.deepEqual(first.calls.opened, []); // held

  const later = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'n1', customerId: 'c1' }]);
  const tenMinLater = new Date(NOW.getTime() + 10 * 60_000);
  await runDispatchCycle([later.specialist], tenMinLater, deps([], [], { crossTypeCooldownMinutes: 5, getCustomerConversations: async () => recentOther }));
  assert.deepEqual(later.calls.opened, ['n1']); // not lost: opened once the cooldown passed
});

test('contact rule: messages about the same kind of problem never hold a case back', async () => {
  const { runDispatchCycle } = await import('./dispatcher.js');
  const justNow = new Date(NOW.getTime() - 60_000).toISOString();
  const { specialist, calls } = fakeSpecialist('w', 'withdrawal_delay', ['withdrawal_delay'], [{ id: 'n2' }]);
  await runDispatchCycle([specialist], NOW, deps([], [], {
    crossTypeCooldownMinutes: 5,
    getCustomerConversations: async () => [{ category: 'withdrawal_delay', agent_last_message_at: justNow }],
  }));
  assert.deepEqual(calls.opened, ['n2']);
});
