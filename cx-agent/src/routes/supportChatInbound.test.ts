import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

// config.ts needs these at import time; the route under test never uses them.
Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x',
});

const SECRET = 'shared-secret-not-real';

async function start(secret: string | undefined) {
  const express = (await import('express')).default;
  const { createSupportChatInboundRouter } = await import('./supportChatInbound.js');
  const handled: Array<{ customerId: string; text: string }> = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/support-chat',
    createSupportChatInboundRouter(
      async (m: { customerId: string; text: string }) => {
        handled.push(m);
      },
      () => secret
    )
  );
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/support-chat/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { post, handled, close: () => server.close() };
}

// The handler runs after the response is sent; give it a tick to record.
const settle = () => new Promise((r) => setTimeout(r, 20));

test('valid secret + body: acknowledges and hands the message to the handler', async () => {
  const s = await start(SECRET);
  const res = await s.post({ customerId: 'c1', text: 'where is my money' }, { 'x-cx-agent-secret': SECRET });
  assert.equal(res.status, 200);
  await settle();
  assert.deepEqual(s.handled, [{ customerId: 'c1', text: 'where is my money' }]);
  s.close();
});

test('wrong or missing secret: 401 and the handler is never called', async () => {
  const s = await start(SECRET);
  assert.equal((await s.post({ customerId: 'c1', text: 'hi' }, { 'x-cx-agent-secret': 'wrong' })).status, 401);
  assert.equal((await s.post({ customerId: 'c1', text: 'hi' })).status, 401);
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('no secret configured: fails closed with 503, even for a request that sends one', async () => {
  const s = await start(undefined);
  const res = await s.post({ customerId: 'c1', text: 'hi' }, { 'x-cx-agent-secret': 'anything' });
  assert.equal(res.status, 503);
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('missing or blank fields: 400', async () => {
  const s = await start(SECRET);
  const h = { 'x-cx-agent-secret': SECRET };
  assert.equal((await s.post({ text: 'hi' }, h)).status, 400);
  assert.equal((await s.post({ customerId: 'c1' }, h)).status, 400);
  assert.equal((await s.post({ customerId: 'c1', text: '   ' }, h)).status, 400);
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('a handler that throws still gets a 200 (the failure is logged, not retried)', async () => {
  const express = (await import('express')).default;
  const { createSupportChatInboundRouter } = await import('./supportChatInbound.js');
  const app = express();
  app.use(express.json());
  app.use(
    '/support-chat',
    createSupportChatInboundRouter(
      async () => {
        throw new Error('model down');
      },
      () => SECRET
    )
  );
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/support-chat/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cx-agent-secret': SECRET },
    body: JSON.stringify({ customerId: 'c1', text: 'hi' }),
  });
  assert.equal(res.status, 200);
  await settle();
  server.close();
});

// --- Sona's forwarder format: "Authorization: Bearer <secret>" + CrazyBet's full payload ---

const crazyBetEvent = (over: Record<string, unknown> = {}) => ({
  event: 'customer_message_received',
  messageId: 'm-100',
  conversationId: 'c-100',
  userId: 'u-100',
  body: 'where is my money',
  createdAt: '2026-10-02T08:00:00.000Z',
  brand: 'crazybet',
  ...over,
});

test('forwarder format: Bearer secret + CrazyBet payload is accepted and mapped to customerId/text/messageId', async () => {
  const s = await start(SECRET);
  const res = await s.post(crazyBetEvent(), { authorization: `Bearer ${SECRET}` });
  assert.equal(res.status, 200);
  await settle();
  assert.deepEqual(s.handled, [{ customerId: 'u-100', text: 'where is my money', messageId: 'm-100' }]);
  s.close();
});

test('forwarder format: a wrong Bearer secret is rejected with 401', async () => {
  const s = await start(SECRET);
  assert.equal((await s.post(crazyBetEvent(), { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await s.post(crazyBetEvent(), { authorization: SECRET })).status, 401); // no "Bearer" word
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('forwarder format: the same messageId forwarded twice is answered once', async () => {
  const s = await start(SECRET);
  const h = { authorization: `Bearer ${SECRET}` };
  assert.equal((await s.post(crazyBetEvent({ messageId: 'dup-9' }), h)).status, 200);
  const second = await s.post(crazyBetEvent({ messageId: 'dup-9' }), h);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).duplicate, true);
  await settle();
  assert.equal(s.handled.length, 1);
  s.close();
});

test('forwarder format: a forwarded event that is not a customer message is acknowledged and ignored', async () => {
  const s = await start(SECRET);
  const res = await s.post({ event: 'something_else', messageId: 'x' }, { authorization: `Bearer ${SECRET}` });
  assert.equal(res.status, 200);
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('the original format still works (x-cx-agent-secret + customerId/text)', async () => {
  const s = await start(SECRET);
  const res = await s.post({ customerId: 'c9', text: 'hi' }, { 'x-cx-agent-secret': SECRET });
  assert.equal(res.status, 200);
  await settle();
  assert.deepEqual(s.handled, [{ customerId: 'c9', text: 'hi' }]);
  s.close();
});
