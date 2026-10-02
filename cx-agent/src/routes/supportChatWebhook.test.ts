import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

const SECRET = 'webhook-secret-not-real';
const sign = (body: string, secret = SECRET) => crypto.createHmac('sha256', secret).update(body).digest('hex');
const settle = () => new Promise((r) => setTimeout(r, 20));

// A real captured payload shape (first live delivery, 2026-09-29): flat, no "data" wrapper.
const customerMessage = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: 'customer_message_received',
    messageId: 'm-1',
    conversationId: 'c-1',
    userId: 'u-1',
    body: 'where is my money',
    createdAt: '2026-10-02T08:00:00.000Z',
    brand: 'crazybet',
    ...over,
  });

async function start(secret: string | undefined, handler?: (m: unknown) => Promise<void>) {
  const express = (await import('express')).default;
  const { createSupportChatWebhookRouter } = await import('./supportChatWebhook.js');
  const handled: Array<{ customerId: string; text: string; messageId?: string }> = [];
  const app = express();
  app.use(
    '/support-chat',
    createSupportChatWebhookRouter(
      handler ??
        (async (m) => {
          handled.push(m);
        }),
      () => secret
    )
  );
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/support-chat/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });
  return { post, handled, close: () => server.close() };
}

test('valid signature: acknowledges and hands customerId, text and messageId to the handler', async () => {
  const s = await start(SECRET);
  const body = customerMessage();
  const res = await s.post(body, { 'x-arena365-signature': sign(body) });
  assert.equal(res.status, 200);
  await settle();
  assert.deepEqual(s.handled, [{ customerId: 'u-1', text: 'where is my money', messageId: 'm-1' }]);
  s.close();
});

test('wrong, missing or tampered signature: 401 and the handler is never called', async () => {
  const s = await start(SECRET);
  const body = customerMessage();
  assert.equal((await s.post(body, { 'x-arena365-signature': sign(body, 'other-secret') })).status, 401);
  assert.equal((await s.post(body)).status, 401);
  assert.equal((await s.post(customerMessage({ body: 'changed after signing' }), { 'x-arena365-signature': sign(body) })).status, 401);
  assert.equal((await s.post(body, { 'x-arena365-signature': 'not-hex!!' })).status, 401);
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('no secret configured: fails closed with 503 even for a request that is signed', async () => {
  const s = await start(undefined);
  const body = customerMessage();
  assert.equal((await s.post(body, { 'x-arena365-signature': sign(body) })).status, 503);
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('the same messageId delivered twice is handled once; the repeat is acknowledged', async () => {
  const s = await start(SECRET);
  const body = customerMessage({ messageId: 'dup-1' });
  const sig = { 'x-arena365-signature': sign(body) };
  assert.equal((await s.post(body, sig)).status, 200);
  const second = await s.post(body, sig);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).duplicate, true);
  await settle();
  assert.equal(s.handled.length, 1);
  s.close();
});

test('other event types are acknowledged without calling the handler', async () => {
  const s = await start(SECRET);
  const body = JSON.stringify({ event: 'something_else', messageId: 'x' });
  assert.equal((await s.post(body, { 'x-arena365-signature': sign(body) })).status, 200);
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('bad JSON and a missing messageId are rejected with 400', async () => {
  const s = await start(SECRET);
  const bad = '{not json';
  assert.equal((await s.post(bad, { 'x-arena365-signature': sign(bad) })).status, 400);
  const noId = customerMessage({ messageId: undefined });
  assert.equal((await s.post(noId, { 'x-arena365-signature': sign(noId) })).status, 400);
  s.close();
});

test('a message with no text or no userId is acknowledged but nothing is handled', async () => {
  const s = await start(SECRET);
  for (const [i, over] of [{ body: '   ' }, { userId: undefined }, { body: undefined }].entries()) {
    const body = customerMessage({ messageId: `empty-${i}`, ...over });
    assert.equal((await s.post(body, { 'x-arena365-signature': sign(body) })).status, 200);
  }
  await settle();
  assert.equal(s.handled.length, 0);
  s.close();
});

test('a handler that throws still gets a 200, and the message can be replayed afterwards', async () => {
  let calls = 0;
  const s = await start(SECRET, async () => {
    calls += 1;
    if (calls === 1) throw new Error('model down');
  });
  const body = customerMessage({ messageId: 'retry-1' });
  const sig = { 'x-arena365-signature': sign(body) };
  assert.equal((await s.post(body, sig)).status, 200);
  await settle();
  const replay = await s.post(body, sig);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, undefined); // not treated as a duplicate: it failed before
  await settle();
  assert.equal(calls, 2);
  s.close();
});

test('through the real server setup: the raw body survives, so a validly signed message is accepted', async () => {
  const { config } = await import('../config.js');
  (config as unknown as Record<string, unknown>).supportChatWebhookSecret = SECRET;
  const { createServer } = await import('../server.js');
  const server = createServer().listen(0);
  const { port } = server.address() as AddressInfo;
  // a non-customer event, so the real (database-backed) handler is never reached
  const body = JSON.stringify({ event: 'ping' });
  const ok = await fetch(`http://127.0.0.1:${port}/support-chat/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-arena365-signature': sign(body) },
    body,
  });
  assert.equal(ok.status, 200); // would be 401 if express.json() had consumed the body first
  const bad = await fetch(`http://127.0.0.1:${port}/support-chat/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-arena365-signature': sign(body, 'wrong') },
    body,
  });
  assert.equal(bad.status, 401);
  server.close();
});
