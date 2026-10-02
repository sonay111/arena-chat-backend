import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// config.ts reads env once, at first import (and requires a few vars), so the
// required ones are set before the dynamic imports below. Per-test settings
// are then applied straight onto the shared config object.
const ME = 'aaaaaaaaaaaaaaaaaaaaaaa1';
Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x',
});

type Mutable = Record<string, unknown>;
async function setup(overrides: Mutable = {}) {
  const { config } = await import('../config.js');
  Object.assign(config as unknown as Mutable, {
    testUserIds: [ME],
    customerIdMap: {},
    supportChatAllowAllCustomers: false,
    supportChatSendEnabled: false,
    supportChatApiBaseUrl: 'https://support.example/v1/support-api',
    supportChatApiKey: 'key-not-real',
    supportChatTenantDomain: 'tenant.example',
    ...overrides,
  });
  return import('./supportChat.js');
}

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = realFetch;
});

test('dry run (default): sends nothing', async () => {
  const { sendToCustomer } = await setup();
  assert.equal(await sendToCustomer(ME, 'hello'), false);
  assert.equal(calls.length, 0);
});

test('never messages a customer outside TEST_USER_IDS, even when sending is on', async () => {
  const { sendToCustomer } = await setup({ supportChatSendEnabled: true });
  assert.equal(await sendToCustomer('someone-else', 'hello'), false);
  assert.equal(calls.length, 0);
});

test('an empty TEST_USER_IDS means nobody can be messaged', async () => {
  const { canMessageCustomer } = await setup({ supportChatSendEnabled: true, testUserIds: undefined });
  assert.equal(canMessageCustomer(ME), false);
});

test('live send: posts body + userId with both auth headers', async () => {
  const { sendToCustomer } = await setup({ supportChatSendEnabled: true });
  assert.equal(await sendToCustomer(ME, 'your withdrawal is pending'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://support.example/v1/support-api/messages');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer key-not-real');
  assert.equal(headers['x-tenant-domain'], 'tenant.example');
  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.body, 'your withdrawal is pending');
  assert.equal(sent.userId, ME);
  assert.match(sent.clientMessageId, /^[0-9a-f-]{36}$/); // unique id generated per message
});

test('live send: a caller-supplied clientMessageId is passed through unchanged (for safe retries)', async () => {
  const { sendToCustomer } = await setup({ supportChatSendEnabled: true });
  await sendToCustomer(ME, 'hi', 'my-stable-id-1');
  assert.equal(JSON.parse(calls[0].init.body as string).clientMessageId, 'my-stable-id-1');
});

test('live send without credentials fails loudly instead of silently dropping', async () => {
  const { sendToCustomer } = await setup({ supportChatSendEnabled: true, supportChatApiKey: undefined });
  await assert.rejects(() => sendToCustomer(ME, 'hi'), /not all set/);
});

test('a failed API response throws', async () => {
  const { sendToCustomer } = await setup({ supportChatSendEnabled: true });
  globalThis.fetch = (async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })) as typeof fetch;
  await assert.rejects(() => sendToCustomer(ME, 'hi'), /401/);
});

const CRAZY = 'bbbbbbbbbbbbbbbbbbbbbbb2';

test('customer id map: a live send goes to the mapped Support Chat user, not the agent\'s own id', async () => {
  const { sendToCustomer } = await setup({ supportChatSendEnabled: true, customerIdMap: { [ME]: CRAZY } });
  assert.equal(await sendToCustomer(ME, 'hi'), true);
  assert.equal(JSON.parse(calls[0].init.body as string).userId, CRAZY);
});

test('customer id map: the allowlist is still checked on the agent\'s own id (the mapped id alone is not enough)', async () => {
  const { sendToCustomer, canMessageCustomer } = await setup({
    supportChatSendEnabled: true,
    testUserIds: [ME],
    customerIdMap: { other: CRAZY },
  });
  assert.equal(canMessageCustomer(CRAZY), false);
  assert.equal(await sendToCustomer('other', 'hi'), false); // 'other' is not allowlisted
  assert.equal(calls.length, 0);
});

test('customer id map: toCustomerId maps a Support Chat id back, and leaves unknown ids alone', async () => {
  const { toCustomerId, toSupportChatUserId } = await setup({ customerIdMap: { [ME]: CRAZY } });
  assert.equal(toCustomerId(CRAZY), ME);
  assert.equal(toCustomerId('someone-unmapped'), 'someone-unmapped');
  assert.equal(toSupportChatUserId(ME), CRAZY);
  assert.equal(toSupportChatUserId('someone-unmapped'), 'someone-unmapped');
});

test('allow-all switch: with it on, a customer who is not on the list can be messaged (each withdrawal goes to its owner)', async () => {
  const { sendToCustomer, canMessageCustomer } = await setup({ supportChatSendEnabled: true, supportChatAllowAllCustomers: true });
  assert.equal(canMessageCustomer('some-other-customer'), true);
  assert.equal(await sendToCustomer('some-other-customer', 'hi'), true);
  assert.equal(JSON.parse(calls[0].init.body as string).userId, 'some-other-customer');
});

test('allow-all switch: off by default, so a customer who is not on the list is still refused', async () => {
  const { canMessageCustomer } = await setup({ supportChatSendEnabled: true });
  assert.equal(canMessageCustomer('some-other-customer'), false);
});

test('a customer that does not exist in Support Chat (404) is skipped with false, not thrown', async () => {
  const { sendToCustomer } = await setup({ supportChatSendEnabled: true, supportChatAllowAllCustomers: true });
  globalThis.fetch = (async () => new Response('{"status":false,"message":"Customer not found"}', { status: 404 })) as typeof fetch;
  assert.equal(await sendToCustomer('ghost-customer', 'hi'), false);
});
