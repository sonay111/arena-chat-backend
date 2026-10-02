import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InFlightGuard } from './inFlight.js';

test('only the first caller may handle a message; a second one at the same time is refused', () => {
  const guard = new InFlightGuard();
  assert.equal(guard.tryAcquire('m1'), true);
  assert.equal(guard.tryAcquire('m1'), false);
  assert.equal(guard.tryAcquire('m2'), true); // other messages are unaffected
});

test('after release, the message can be tried again (this is how a failed attempt gets retried)', () => {
  const guard = new InFlightGuard();
  guard.tryAcquire('m1');
  guard.release('m1');
  assert.equal(guard.tryAcquire('m1'), true);
});
