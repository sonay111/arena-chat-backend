import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

const alert = (paymentId: string) => ({ paymentId }) as never;

test('filterAlertsByPaymentIds: with no ids configured, every alert passes through unchanged', async () => {
  const { filterAlertsByPaymentIds } = await import('./withdrawalFeed.js');
  const all = [alert('a'), alert('b')];
  assert.deepEqual(filterAlertsByPaymentIds(all, undefined), all);
  assert.deepEqual(filterAlertsByPaymentIds(all, []), all);
});

test('filterAlertsByPaymentIds: with ids configured, only those payments are kept', async () => {
  const { filterAlertsByPaymentIds } = await import('./withdrawalFeed.js');
  const kept = filterAlertsByPaymentIds([alert('a'), alert('b'), alert('c')], ['b']);
  assert.equal(kept.length, 1);
  assert.equal((kept[0] as { paymentId: string }).paymentId, 'b');
});
