import { test } from 'node:test';
import assert from 'node:assert/strict';

// serviceHealth.ts builds a URL from this at import time.
process.env.WITHDRAWAL_FEED_URL = 'http://x.example/alerts/withdrawal-delays';

// A stale Hero check, the exact situation that used to trigger a live browser alert.
const staleHero = {
  gatewayKey: 'hero',
  gatewayLabel: 'Hero',
  checkKey: 'payout',
  checkLabel: 'Payout',
  status: 'delayed',
  lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

test('browserAlertsEnabled: off unless GATEWAY_BROWSER_ALERTS is exactly "true"', async () => {
  const { browserAlertsEnabled } = await import('./serviceHealth.js');
  delete process.env.GATEWAY_BROWSER_ALERTS;
  assert.equal(browserAlertsEnabled(), false);
  process.env.GATEWAY_BROWSER_ALERTS = 'yes';
  assert.equal(browserAlertsEnabled(), false);
  process.env.GATEWAY_BROWSER_ALERTS = 'true';
  assert.equal(browserAlertsEnabled(), true);
  delete process.env.GATEWAY_BROWSER_ALERTS;
});

test('switch off (the default): a stale Hero gateway sends nothing', async () => {
  const { notifyStaleAlertGateways } = await import('./serviceHealth.js');
  const sent: string[] = [];
  await notifyStaleAlertGateways([staleHero], async (m) => { sent.push(m); }, () => false);
  assert.equal(sent.length, 0);
});

test('switch on: the same stale gateway still sends (the demo keeps working)', async () => {
  const { notifyStaleAlertGateways } = await import('./serviceHealth.js');
  const sent: string[] = [];
  await notifyStaleAlertGateways([staleHero], async (m) => { sent.push(m); }, () => true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Hero is currently delayed/);
});

test('with the real default switch and no env var, nothing is sent', async () => {
  const { notifyStaleAlertGateways } = await import('./serviceHealth.js');
  delete process.env.GATEWAY_BROWSER_ALERTS;
  const sent: string[] = [];
  // only the sender is stubbed; the switch is the real default
  await notifyStaleAlertGateways([{ ...staleHero, gatewayKey: 'crypto', gatewayLabel: 'Crypto' }], async (m) => { sent.push(m); });
  assert.equal(sent.length, 0);
});
