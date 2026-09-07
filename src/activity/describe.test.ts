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
  assert.equal(
    describeEvent("sportsbook.bet_settled", REAL_WIN),
    "Bet won — 7.75 USDT returned (1st innings over 2 - 3rd delivery Mi Cape Town SRL total)"
  );
});

// Real payload shape from actual traffic (see the raw_webhook_events
// investigation this was pulled from) — a win. No real "lost" example
// exists on file yet; CASINO_LOST below is written defensively on the
// same status-field pattern bets use, not verified against real traffic.
const CASINO_WIN = {
  status: "won",
  userId: "6a86938201ee2322b99daba7",
  session: "5d6483cc-0cd8-4a0c-b81c-a0c0c8ae05ac",
  currency: "INR",
  gameName: "spb_aviator",
  stakeAmount: 500,
  gameProvider: "spb",
  returnAmount: 575,
  winLossAmount: 75,
};

const CASINO_LOST = {
  status: "lost",
  userId: "6a86938201ee2322b99daba7",
  session: "aaaaaaaa-0000-0000-0000-000000000000",
  currency: "INR",
  gameName: "spb_aviator",
  stakeAmount: 100,
  gameProvider: "spb",
  returnAmount: 0,
  winLossAmount: -100,
};

test("casino.session_settled — a win uses returnAmount and gameName, same pattern as bets", () => {
  assert.equal(describeEvent("casino.session_settled", CASINO_WIN), "Casino session won — ₹575 returned (spb_aviator)");
});

test("casino.session_settled — a loss uses stakeAmount, not winLossAmount (defensive, no real example on file)", () => {
  assert.equal(describeEvent("casino.session_settled", CASINO_LOST), "Casino session lost — ₹100 staked (spb_aviator)");
});

test("casino.session_settled — amounts round to 2 decimal places (real traffic showed the same float imprecision as bets)", () => {
  const won = { status: "won", currency: "INR", returnAmount: 13.3, gameName: "spb_aviator" };
  assert.equal(describeEvent("casino.session_settled", won), "Casino session won — ₹13.3 returned (spb_aviator)");

  const wonWithImprecision = { status: "won", currency: "USDT", returnAmount: 0.1 + 0.2, gameName: "spb_aviator" };
  assert.equal(describeEvent("casino.session_settled", wonWithImprecision), "Casino session won — 0.3 USDT returned (spb_aviator)");
});

test("casino.session_settled — missing gameName omits the parenthetical instead of showing '()'", () => {
  assert.equal(describeEvent("casino.session_settled", { status: "won", currency: "INR", returnAmount: 575 }), "Casino session won — ₹575 returned");
});

test("getEventMeta: casino.session_settled gets outcome but never tournamentName", () => {
  assert.deepEqual(getEventMeta("casino.session_settled", CASINO_WIN), { outcome: "won" });
  assert.deepEqual(getEventMeta("casino.session_settled", CASINO_LOST), { outcome: "lost" });

  // Confirms gameProvider/gameName are never repurposed into tournamentName,
  // even though they're present in a real casino payload.
  const meta = getEventMeta("casino.session_settled", CASINO_WIN);
  assert.ok(!("tournamentName" in meta), "casino events must never have a tournamentName key");
});
