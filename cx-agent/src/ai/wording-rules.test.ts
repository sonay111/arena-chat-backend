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

// ---- Wording fixes from the first live life-cycle test (2026-10-02) --------------------------
// The agent's instructions AND its examples must agree with the rules. The model copies examples.

test('instructions and examples never promise a human follow-up', () => {
  for (const phrase of [
    'member of the team will follow up',
    'member of the team can give',
    'member of the team can help',
    'team is looking into it',
    'team will follow up',
    'someone on the team',
    "I'll follow up with you",
  ]) {
    assert.equal(prompt.includes(phrase), false, `drafts.ts still contains: ${phrase}`);
  }
});

test('instructions and examples never say the funds are safely held or being sent', () => {
  for (const phrase of ['safely held', 'funds are now being sent', 'being sent to the\ncustomer', 'being sent to your selected']) {
    assert.equal(prompt.includes(phrase), false, `drafts.ts still contains: ${phrase}`);
  }
});

test('a pending withdrawal is called "pending", not "processing", in instructions and examples', () => {
  for (const phrase of ['still processing', 'still being processed', 'currently being processed']) {
    assert.equal(prompt.includes(phrase), false, `drafts.ts still contains: ${phrase}`);
  }
  // "working its way through" may appear only once: inside the rule that forbids it.
  assert.equal(prompt.split('working its way through').length - 1, 1);
  assert.match(prompt, /While current_status is PENDING, call the withdrawal "pending"/);
});

test('the rules forbid promising that a person will follow up', () => {
  assert.match(prompt, /Say or imply that a person, a team member, or support will contact the\s+customer/);
});

test('the completed message says "marked as completed", not that funds are being sent', () => {
  assert.match(prompt, /has been marked as completed on our side/);
});

test('the "no record" reply makes no promise of a team follow-up', async () => {
  const { noRecordFoundNote } = await import('../messages/templates.js');
  assert.doesNotMatch(noRecordFoundNote(), /team|flagged|follow/i);
});
