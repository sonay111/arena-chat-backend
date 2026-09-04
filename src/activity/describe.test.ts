import { test } from "node:test";
import assert from "node:assert/strict";
import { describeEvent } from "./describe.js";

test("each known event type produces a sensible, human-readable description", () => {
  assert.equal(describeEvent("user.registered", {}), "Player registered");
  assert.equal(
    describeEvent("withdrawal.initiated", { amount: 5000, currency: "INR" }),
    "Withdrawal initiated — ₹5000"
  );
  assert.equal(
    describeEvent("deposit.completed", { amount: 9, currency: "usdttrc20" }),
    "Deposit completed — 9 USDTTRC20"
  );
  assert.equal(describeEvent("bonus.expired", {}), "Bonus expired");
  assert.equal(describeEvent("bonus.activated", {}), "Bonus activated");
  assert.equal(describeEvent("player.refresh_detected", {}), "Screen refresh detected");
  assert.equal(describeEvent("sportsbook.bet_settled", {}), "Bet settled");
});

test("an unrecognized event name falls back to a humanized version, not a crash or blank string", () => {
  assert.equal(describeEvent("casino.session_settled", {}), "Casino session settled");
  assert.equal(describeEvent("some_new.event_type", {}), "Some new event type");
});

test("missing amount/currency degrades gracefully instead of printing 'undefined' or a dangling separator", () => {
  assert.equal(describeEvent("deposit.completed", {}), "Deposit completed");
  assert.equal(describeEvent("withdrawal.initiated", { amount: 20 }), "Withdrawal initiated — 20");
});
