import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

Object.assign(process.env, {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_KEY: 'x',
  ANTHROPIC_API_KEY: 'x',
  WITHDRAWAL_FEED_URL: 'http://x.example/alerts/withdrawal-delays',
});

test('getEtaText never promises a timeframe, for any currency', async () => {
  const { getEtaText } = await import('../feed/withdrawalFeed.js');
  for (const currency of ['INR', 'USD', 'EUR', 'GBP', 'usdttrc20', null]) {
    assert.equal(getEtaText({ currency, paymentId: 'p', userId: 'u' } as never), null);
  }
});

// The agent's rules live in a prompt string, so these read the source to make sure the three
// rules added after the first live test stay in place.
const prompt = readFileSync(join(__dirname, 'drafts.ts'), 'utf8');

test('prompt forbids any "window" / typical processing time without a verified timeframe', () => {
  assert.match(prompt, /"window", "typical processing time", or "business days"/);
});

test('prompt forbids claiming where the money is or that it is safe / held', () => {
  assert.match(prompt, /where the customer's money is, or that it is safe, secure,\s+held, protected/);
});

test('prompt forbids describing a recurring check schedule', () => {
  assert.match(prompt, /Never describe a recurring schedule/);
});
