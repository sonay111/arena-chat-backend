import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

const SINCE = new Date('2026-10-02T14:19:00.000Z');

test('true when the customer ended their newest chat after the withdrawal began', async () => {
  const { customerEndedChat } = await import('./supportChat.js');
  assert.equal(customerEndedChat([{ status: 'closed', endedBy: 'customer', endedAt: '2026-10-02T14:35:23.000Z' }], SINCE), true);
});

test('false when the chat is still open, or no chat exists', async () => {
  const { customerEndedChat } = await import('./supportChat.js');
  assert.equal(customerEndedChat([{ status: 'active', endedBy: null, endedAt: null }], SINCE), false);
  assert.equal(customerEndedChat([{ status: 'waiting' }], SINCE), false);
  assert.equal(customerEndedChat([], SINCE), false);
});

test('false when it was ended by staff, not the customer', async () => {
  const { customerEndedChat } = await import('./supportChat.js');
  assert.equal(customerEndedChat([{ status: 'closed', endedBy: 'operator', endedAt: '2026-10-02T14:35:23.000Z' }], SINCE), false);
});

test('false when the chat was ended before this withdrawal began', async () => {
  const { customerEndedChat } = await import('./supportChat.js');
  assert.equal(customerEndedChat([{ status: 'closed', endedBy: 'customer', endedAt: '2026-10-01T09:00:00.000Z' }], SINCE), false);
});

test('only the NEWEST chat counts: a customer who came back (new open chat) gets reminders again', async () => {
  const { customerEndedChat } = await import('./supportChat.js');
  const returned = [
    { status: 'active', endedBy: null, endedAt: null }, // newest: open again
    { status: 'closed', endedBy: 'customer', endedAt: '2026-10-02T14:35:23.000Z' },
  ];
  assert.equal(customerEndedChat(returned, SINCE), false);
});
