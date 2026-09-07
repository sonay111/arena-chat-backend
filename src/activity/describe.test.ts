import { test } from "node:test";
import assert from "node:assert/strict";
import { describeEvent, getEventMeta } from "./describe.js";

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

// Real payload shapes from actual traffic (see the raw_webhook_events
// investigation these were pulled from) — a win and a loss.
const REAL_WIN = {
  status: "won",
  currency: "USDT",
  stakeAmount: 5,
  returnAmount: 7.75,
  winLossAmount: 2.75,
  eventMarketInformation: {
    betName: "",
    matchId: "sr:match:73284074",
    teamName: "over 0.5",
    marketName: "1st innings over 2 - 3rd delivery Mi Cape Town SRL total",
    sportsType: "sr:sport:21",
    tournamentName: "Mi Cape Town SRL vs Durban Super Giants SRL",
  },
};

const REAL_LOSS = {
  status: "lost",
  currency: "USDT",
  stakeAmount: 2,
  returnAmount: 0,
  winLossAmount: -2,
  eventMarketInformation: {
    betName: "",
    matchId: "sr:match:73237410",
    teamName: "South Delhi Superstars",
    marketName: "Winner (incl. super over)",
    sportsType: "sr:sport:21",
    tournamentName: "North Delhi Strikers vs South Delhi Superstars",
  },
};

test("sportsbook.bet_settled — a win uses returnAmount and the market name, never teamName", () => {
  assert.equal(
    describeEvent("sportsbook.bet_settled", REAL_WIN),
    "Bet won — 7.75 USDT returned (1st innings over 2 - 3rd delivery Mi Cape Town SRL total)"
  );
});

test("sportsbook.bet_settled — a loss uses stakeAmount, not winLossAmount", () => {
  assert.equal(
    describeEvent("sportsbook.bet_settled", REAL_LOSS),
    "Bet lost — 2 USDT staked (Winner (incl. super over))"
  );
});

test("sportsbook.bet_settled — amounts round to 2 decimal places", () => {
  // Classic JS float artifact (0.1 + 0.2), standing in for the kind of
  // imprecision real winLossAmount/returnAmount values showed in practice.
  const won = { status: "won", currency: "USDT", returnAmount: 0.1 + 0.2 };
  assert.equal(describeEvent("sportsbook.bet_settled", won), "Bet won — 0.3 USDT returned");
});

test("sportsbook.bet_settled — INR renders with the rupee symbol, same as every other event type", () => {
  const won = { status: "won", currency: "INR", returnAmount: 250, eventMarketInformation: { marketName: "Match odds" } };
  assert.equal(describeEvent("sportsbook.bet_settled", won), "Bet won — ₹250 returned (Match odds)");
});

test("sportsbook.bet_settled — missing marketName omits the parenthetical instead of showing '()'", () => {
  assert.equal(describeEvent("sportsbook.bet_settled", { status: "won", currency: "USDT", returnAmount: 5 }), "Bet won — 5 USDT returned");
});

test("getEventMeta returns outcome + tournamentName only for sportsbook.bet_settled", () => {
  assert.deepEqual(getEventMeta("sportsbook.bet_settled", REAL_WIN), {
    outcome: "won",
    tournamentName: "Mi Cape Town SRL vs Durban Super Giants SRL",
  });
  assert.deepEqual(getEventMeta("sportsbook.bet_settled", REAL_LOSS), {
    outcome: "lost",
    tournamentName: "North Delhi Strikers vs South Delhi Superstars",
  });
});

test("getEventMeta returns nothing for any other event type — other event types are unaffected", () => {
  assert.deepEqual(getEventMeta("withdrawal.initiated", { amount: 5000, currency: "INR" }), {});
  assert.deepEqual(getEventMeta("user.registered", {}), {});
  assert.deepEqual(getEventMeta("bonus.expired", {}), {});
});

test("other event types' descriptions are byte-for-byte unchanged by this update", () => {
  assert.equal(describeEvent("user.registered", {}), "Player registered");
  assert.equal(describeEvent("withdrawal.initiated", { amount: 5000, currency: "INR" }), "Withdrawal initiated — ₹5000");
  assert.equal(describeEvent("deposit.completed", { amount: 9, currency: "usdttrc20" }), "Deposit completed — 9 USDTTRC20");
  assert.equal(describeEvent("bonus.expired", {}), "Bonus expired");
  assert.equal(describeEvent("player.refresh_detected", {}), "Screen refresh detected");
});
