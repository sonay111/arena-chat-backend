import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeServiceHealth, findEntry, toLeaf, toGroup, toNode } from "./normalize.js";
import type { RawEntry, RawServiceHealthResponse, NormalizedCategory, NormalizedGroup, NormalizedLeaf } from "./types.js";

// Trimmed but real-shaped fixture -- field values below mirror the real
// GET /service-health response captured live 2026-09-22/2026-09-23, minus
// fields this module doesn't read (lastSuccessAgeMs, expectedIntervalMs,
// etc.). `service` defaults to "payment" (most fixtures below are payment
// gateways or business_flow_* entries, both really service "payment") --
// tests for admin-api/casino/socket entries override it explicitly, since
// findEntry (normalize.ts) now looks up by service+key together, never
// key alone.
function rawCheck(overrides: Partial<RawEntry> = {}): any {
  return {
    service: "payment",
    key: "some_check",
    label: "Some Check",
    method: "webhook",
    status: "unknown",
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    responseTimeMs: null,
    ...overrides,
  };
}

function buildRaw(entries: RawEntry[]): RawServiceHealthResponse {
  return {
    status: true,
    checkedAt: "2026-09-22T04:14:15.614Z",
    summary: { total: entries.length, worst: "down", ok: 0, delayed: 0, down: 0, unknown: 0 },
    data: entries,
  };
}

const SPORTSBOOK_STUB: NormalizedCategory = {
  key: "sportsbook",
  label: "Sportsbook",
  status: "ok",
  realCoverage: "full",
  checks: [],
};

test("normalizeServiceHealth: emits all 8 categories in the fixed order Payments, CRM, Notifications, Casino, Sportsbook, KYC & Risk, Comms, Other", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  assert.deepEqual(
    result.categories.map((c) => c.key),
    ["payments", "crm", "notifications", "casino", "sportsbook", "kyc_risk", "comms", "other"]
  );
});

test("normalizeServiceHealth: passes checkedAt through from the raw response", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  assert.equal(result.checkedAt, "2026-09-22T04:14:15.614Z");
});

test("Payments: maps all 8 real gateways, each as a group of its own flows (real rolezpay shape: unknown x4 + ok -> parent ok)", () => {
  const rolezpay = rawCheck({
    key: "rolezpay",
    label: "Rolezpay",
    status: "ok",
    flows: [
      rawCheck({ key: "payin_initiate", status: "unknown" }),
      rawCheck({ key: "payin_webhook", status: "unknown" }),
      rawCheck({ key: "payout_initiate", status: "unknown" }),
      rawCheck({ key: "payout_webhook", status: "unknown" }),
      rawCheck({ key: "ping", label: "Balance Ping", method: "ping", status: "ok" }),
    ],
  });
  const result = normalizeServiceHealth(buildRaw([rolezpay]), SPORTSBOOK_STUB);
  const payments = result.categories.find((c) => c.key === "payments")!;
  assert.equal(payments.realCoverage, "full");
  assert.equal(payments.checks.length, 1);
  const group = payments.checks[0] as NormalizedGroup;
  assert.equal(group.kind, "group");
  assert.equal(group.key, "rolezpay");
  assert.equal(group.status, "ok", "our computed worst-of-children matches Satyam's own raw parent status here");
  assert.equal(group.children.length, 5);
});

test("Payments: a group's lastSuccessAt is the most recent among its children (real pay777 shape: two delayed flows with different lastSuccessAt)", () => {
  const pay777 = rawCheck({
    key: "pay777",
    label: "Pay777",
    status: "delayed",
    flows: [
      rawCheck({ key: "payin_initiate", label: "Payin Initiate", status: "delayed", lastSuccessAt: "2026-09-20T10:03:01.269Z" }),
      rawCheck({ key: "payin_webhook", label: "Payin Webhook", status: "delayed", lastSuccessAt: "2026-09-20T10:30:00.863Z" }),
      rawCheck({ key: "payout_webhook", status: "unknown" }),
    ],
  });
  const result = normalizeServiceHealth(buildRaw([pay777]), SPORTSBOOK_STUB);
  const group = (result.categories.find((c) => c.key === "payments")!.checks[0]) as NormalizedGroup;
  assert.equal(group.lastSuccessAt, "2026-09-20T10:30:00.863Z", "the later of the two delayed flows' timestamps wins");
});

test("Payments: a group's issueDetail names the first flow at the worst severity, with a humanized age (real pay777 shape)", () => {
  const pay777raw: RawServiceHealthResponse = {
    status: true,
    checkedAt: "2026-09-22T10:00:00.000Z",
    summary: { total: 1, worst: "delayed", ok: 0, delayed: 1, down: 0, unknown: 0 },
    data: [
      rawCheck({
        key: "pay777",
        label: "Pay777",
        status: "delayed",
        flows: [
          rawCheck({ key: "payin_initiate", label: "Payin Initiate", status: "delayed", lastSuccessAt: "2026-09-20T12:00:00.000Z" }),
          rawCheck({ key: "payin_webhook", label: "Payin Webhook", status: "delayed", lastSuccessAt: "2026-09-21T12:00:00.000Z" }),
          rawCheck({ key: "payout_webhook", status: "unknown" }),
        ],
      }),
    ],
  };
  const result = normalizeServiceHealth(pay777raw, SPORTSBOOK_STUB);
  const group = (result.categories.find((c) => c.key === "payments")!.checks[0]) as NormalizedGroup;
  assert.equal(
    group.issueDetail,
    "Payin Initiate delayed — last succeeded 1d 22h ago",
    "the FIRST delayed flow in original order is named, not the one with the oldest/newest success"
  );
});

test("Payments: a group's issueDetail is null when status is ok (real rolezpay shape), not just when it's unknown", () => {
  const rolezpay = rawCheck({
    key: "rolezpay",
    status: "ok",
    flows: [
      rawCheck({ key: "payin_initiate", status: "unknown" }),
      rawCheck({ key: "ping", label: "Balance Ping", status: "ok", lastSuccessAt: "2026-09-22T04:10:00.968Z" }),
    ],
  });
  const result = normalizeServiceHealth(buildRaw([rolezpay]), SPORTSBOOK_STUB);
  const group = (result.categories.find((c) => c.key === "payments")!.checks[0]) as NormalizedGroup;
  assert.equal(group.issueDetail, null);
});

test("Payments: issueDetail falls back to 'no successful check recorded' when the responsible flow has never succeeded", () => {
  const pay777 = rawCheck({
    key: "pay777",
    status: "delayed",
    flows: [rawCheck({ key: "payin_initiate", label: "Payin Initiate", status: "delayed", lastSuccessAt: null })],
  });
  const result = normalizeServiceHealth(buildRaw([pay777]), SPORTSBOOK_STUB);
  const group = (result.categories.find((c) => c.key === "payments")!.checks[0]) as NormalizedGroup;
  assert.equal(group.issueDetail, "Payin Initiate delayed — no successful check recorded");
});

test("Payments: a group's lastFailureAt is the most recent among its children when any child has failed", () => {
  const pay777 = rawCheck({
    key: "pay777",
    status: "down",
    flows: [
      rawCheck({ key: "payin_initiate", status: "down", lastFailureAt: "2026-09-21T00:00:00.000Z" }),
      rawCheck({ key: "payin_webhook", status: "down", lastFailureAt: "2026-09-22T00:00:00.000Z" }),
    ],
  });
  const result = normalizeServiceHealth(buildRaw([pay777]), SPORTSBOOK_STUB);
  const group = (result.categories.find((c) => c.key === "payments")!.checks[0]) as NormalizedGroup;
  assert.equal(group.lastFailureAt, "2026-09-22T00:00:00.000Z");
});

test("Payments: a group's responseTimeMs always stays null -- averaging across flows isn't meaningful", () => {
  const pay777 = rawCheck({
    key: "pay777",
    status: "delayed",
    flows: [rawCheck({ key: "payin_initiate", status: "delayed", responseTimeMs: 889 })],
  });
  const result = normalizeServiceHealth(buildRaw([pay777]), SPORTSBOOK_STUB);
  const group = (result.categories.find((c) => c.key === "payments")!.checks[0]) as NormalizedGroup;
  assert.equal(group.responseTimeMs, null);
});

test("Other: business_flow_deposit's group also gets derived summary fields, same as a payment gateway", () => {
  const deposit = rawCheck({
    key: "business_flow_deposit",
    label: "Deposit → Wallet Credit",
    status: "down",
    steps: [
      rawCheck({ key: "callback_received", label: "Gateway Callback Received", status: "down", lastSuccessAt: "2026-09-20T00:00:00.000Z" }),
      rawCheck({ key: "transaction_updated", status: "unknown" }),
    ],
  });
  const result = normalizeServiceHealth(buildRaw([deposit]), SPORTSBOOK_STUB);
  const group = (result.categories.find((c) => c.key === "other")!.checks[0]) as NormalizedGroup;
  assert.equal(group.lastSuccessAt, "2026-09-20T00:00:00.000Z");
  assert.ok(group.issueDetail!.startsWith("Gateway Callback Received down —"), "issueDetail names the down step");
});

test("Payments: a gateway missing from the real response is simply omitted, not fabricated", () => {
  const pay777 = rawCheck({ key: "pay777", label: "Pay777", status: "delayed", flows: [rawCheck({ status: "delayed" })] });
  const result = normalizeServiceHealth(buildRaw([pay777]), SPORTSBOOK_STUB);
  const payments = result.categories.find((c) => c.key === "payments")!;
  assert.equal(payments.checks.length, 1);
  assert.equal((payments.checks[0] as NormalizedGroup).key, "pay777");
});

test("Payments: ocr_deposit_slip (category 'ocr' in the raw response, not a named gateway) rides along as a 9th leaf entry, not dropped", () => {
  const ocr = rawCheck({ key: "ocr_deposit_slip", label: "OCR / Deposit Slip Verification", method: "response", status: "unknown" });
  const result = normalizeServiceHealth(buildRaw([ocr]), SPORTSBOOK_STUB);
  const payments = result.categories.find((c) => c.key === "payments")!;
  assert.equal(payments.checks.length, 1);
  const leaf = payments.checks[0] as NormalizedLeaf;
  assert.equal(leaf.kind, "leaf");
  assert.equal(leaf.key, "ocr_deposit_slip");
});

test("Payments: category status is worst-of-gateways (real shape: one delayed gateway among several ok/unknown)", () => {
  const rolezpay = rawCheck({
    key: "rolezpay",
    status: "ok",
    flows: [rawCheck({ key: "ping", status: "ok" }), rawCheck({ key: "payin_initiate", status: "unknown" })],
  });
  const pay777 = rawCheck({ key: "pay777", status: "delayed", flows: [rawCheck({ key: "payin_initiate", status: "delayed" })] });
  const result = normalizeServiceHealth(buildRaw([rolezpay, pay777]), SPORTSBOOK_STUB);
  const payments = result.categories.find((c) => c.key === "payments")!;
  assert.equal(payments.status, "delayed");
});

test("CRM: maps the crm entry as a single 'CRM & FastTrack' parent row over its 4 flows, same pattern as every other group (real shape: unknown x3 + ok -> parent ok)", () => {
  const crm = rawCheck({
    service: "admin-api",
    key: "crm",
    label: "CRM & FastTrack",
    status: "ok",
    flows: [
      rawCheck({ key: "outbound_webhook", status: "unknown" }),
      rawCheck({ key: "inbound_api", label: "CRM Inbound API", method: "inbound", status: "ok", lastSuccessAt: "2026-09-22T04:14:08.750Z" }),
      rawCheck({ key: "fasttrack_outbound", status: "unknown" }),
      rawCheck({ key: "fasttrack_inbound", status: "unknown" }),
    ],
  });
  const result = normalizeServiceHealth(buildRaw([crm]), SPORTSBOOK_STUB);
  const crmCategory = result.categories.find((c) => c.key === "crm")!;
  assert.equal(crmCategory.realCoverage, "full");
  assert.equal(crmCategory.status, "ok");
  assert.equal(crmCategory.checks.length, 1, "one parent row, not the 4 flows flattened onto the category directly");

  const group = crmCategory.checks[0] as NormalizedGroup;
  assert.equal(group.kind, "group");
  assert.equal(group.key, "crm");
  assert.equal(group.label, "CRM & FastTrack");
  assert.equal(group.status, "ok");
  assert.equal(group.lastSuccessAt, "2026-09-22T04:14:08.750Z", "rolled up from the one real ok flow, same as every other group");
  assert.equal(group.issueDetail, null, "ok status -- nothing to point at");
  assert.equal(group.children.length, 4);
});

test("CRM: not_integrated when the crm entry is entirely absent", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  const crmCategory = result.categories.find((c) => c.key === "crm")!;
  assert.equal(crmCategory.status, "not_integrated");
  assert.equal(crmCategory.realCoverage, "none");
});

test("Notifications: maps OneSignal + In-App Notifications as two named groups, fully real", () => {
  const onesignal = rawCheck({ service: "admin-api", key: "onesignal", label: "OneSignal Push", status: "unknown", flows: [rawCheck({ key: "campaign_send", status: "unknown" })] });
  const inApp = rawCheck({ service: "admin-api", key: "notifications", label: "In-App Notifications", status: "unknown", flows: [rawCheck({ key: "in_app", status: "unknown" })] });
  const result = normalizeServiceHealth(buildRaw([onesignal, inApp]), SPORTSBOOK_STUB);
  const notifications = result.categories.find((c) => c.key === "notifications")!;
  assert.equal(notifications.realCoverage, "full");
  assert.equal(notifications.checks.length, 2);
  assert.deepEqual(notifications.checks.map((c) => c.key), ["onesignal", "notifications"]);
});

test("Notifications: partial when only one of the two real sources is present", () => {
  const onesignal = rawCheck({ service: "admin-api", key: "onesignal", status: "unknown", flows: [rawCheck({ status: "unknown" })] });
  const result = normalizeServiceHealth(buildRaw([onesignal]), SPORTSBOOK_STUB);
  const notifications = result.categories.find((c) => c.key === "notifications")!;
  assert.equal(notifications.realCoverage, "partial");
});

test("Casino: maps st8_casino_callbacks as a leaf and flags partial coverage", () => {
  const st8 = rawCheck({ service: "casino", key: "st8_casino_callbacks", label: "ST8 Casino Callbacks", method: "callback", status: "delayed" });
  const result = normalizeServiceHealth(buildRaw([st8]), SPORTSBOOK_STUB);
  const casino = result.categories.find((c) => c.key === "casino")!;
  assert.equal(casino.status, "delayed");
  assert.equal(casino.realCoverage, "partial");
  assert.ok(casino.note?.includes("ST8 Casino Callbacks"));
  assert.equal(casino.checks.length, 1);
  assert.equal(casino.checks[0].kind, "leaf");
});

test("Casino: not_integrated when st8_casino_callbacks is absent", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  const casino = result.categories.find((c) => c.key === "casino")!;
  assert.equal(casino.status, "not_integrated");
  assert.equal(casino.realCoverage, "none");
});

// Sportsbook is two separate, visible rows: "Our Connection" (exactly
// today's existing derivation, from sportsbook.ts's computeSportsbookHealth
// -- passed in here as ourConnectionSource, untouched, just re-wrapped
// into a named group) and "Provider Health" (new: 6 real checks from
// /service-health that no other category covers).

test("Sportsbook: emits exactly two top-level rows, Our Connection and Provider Health", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;
  assert.deepEqual(
    sportsbook.checks.map((c) => c.key),
    ["our_connection", "provider_health"]
  );
  assert.ok(sportsbook.checks.every((c) => c.kind === "group"), "both rows are groups, not bare leaves");
});

test("Our Connection: wraps the injected category's own checks completely untouched, not derived from /service-health at all", () => {
  const ourConnectionSource: NormalizedCategory = {
    key: "sportsbook",
    label: "Sportsbook",
    status: "down",
    realCoverage: "full",
    checks: [
      { kind: "leaf", key: "odds_feed_connection", label: "Odds Feed Connection", method: "internal", status: "down", lastSuccessAt: null, lastFailureAt: null, lastError: null, responseTimeMs: null },
      { kind: "leaf", key: "producer_status", label: "Producer Status (current live matches)", method: "internal", status: "ok", lastSuccessAt: null, lastFailureAt: null, lastError: null, responseTimeMs: null },
    ],
  };
  const result = normalizeServiceHealth(buildRaw([]), ourConnectionSource);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;
  const ourConnection = sportsbook.checks.find((c) => c.key === "our_connection") as NormalizedGroup;

  assert.equal(ourConnection.label, "Our Connection");
  assert.deepEqual(ourConnection.children, ourConnectionSource.checks, "the two underlying signals are passed through completely untouched");
  assert.equal(ourConnection.status, "down", "worst-of the two untouched leaves -- same aggregation rule as everywhere else");
});

test("Provider Health: aggregates the 6 real checks (real shape: all 6 ok)", () => {
  const entries = [
    rawCheck({ service: "socket", key: "socket_connections", label: "Live Odds Broadcast", method: "poll", status: "ok", lastSuccessAt: "2026-09-23T04:39:49.474Z", responseTimeMs: 1 }),
    rawCheck({ service: "socket", key: "sr_bet_settlement", label: "Market Settlement Feed", method: "poll", status: "ok", lastSuccessAt: "2026-09-23T04:39:50.034Z", responseTimeMs: 21 }),
    rawCheck({ service: "socket", key: "sr_bet_settlement_processing", label: "Bet Settlement Processing", method: "poll", status: "ok", lastSuccessAt: "2026-09-23T00:38:18.838Z", responseTimeMs: 33 }),
    rawCheck({ service: "socket", key: "sr_tier1_settlement_sla", label: "Tier 1 Settlement SLA (5min)", method: "poll", status: "ok", lastSuccessAt: "2026-09-23T04:39:39.275Z", responseTimeMs: 1 }),
    rawCheck({ service: "odds_streamer", key: "partner_odds_feed_relay", label: "Outbound Odds Feed to Partners", method: "poll", status: "ok", lastSuccessAt: "2026-09-23T04:39:49.474Z", responseTimeMs: 1 }),
    // Real duplicate: also exists under service "socket" with identical data -- see the dedup test below.
    rawCheck({ service: "odds_streamer", key: "sportsradar_producer_connection", label: "SportRadar Producer Connection", method: "poll", status: "ok", lastSuccessAt: "2026-09-23T04:39:37.098Z", responseTimeMs: 2 }),
  ];
  const result = normalizeServiceHealth(buildRaw(entries), SPORTSBOOK_STUB);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;
  const providerHealth = sportsbook.checks.find((c) => c.key === "provider_health") as NormalizedGroup;

  assert.equal(providerHealth.label, "Provider Health");
  assert.equal(providerHealth.children.length, 6);
  assert.equal(providerHealth.status, "ok");
  assert.deepEqual(
    providerHealth.children.map((c) => c.key),
    [
      "socket_connections",
      "sr_bet_settlement",
      "sr_bet_settlement_processing",
      "sr_tier1_settlement_sla",
      "partner_odds_feed_relay",
      "sportsradar_producer_connection",
    ]
  );
});

test("Provider Health: the SportRadar Producer Connection duplicate (service socket vs odds_streamer, real collision) only appears once, using the odds_streamer instance", () => {
  const socketVariant = rawCheck({ service: "socket", key: "sportsradar_producer_connection", label: "SportRadar Producer Connection", method: "poll", status: "ok", responseTimeMs: 2 });
  const oddsStreamerVariant = rawCheck({ service: "odds_streamer", key: "sportsradar_producer_connection", label: "SportRadar Producer Connection", method: "poll", status: "delayed", responseTimeMs: 999 });
  const result = normalizeServiceHealth(buildRaw([socketVariant, oddsStreamerVariant]), SPORTSBOOK_STUB);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;
  const providerHealth = sportsbook.checks.find((c) => c.key === "provider_health") as NormalizedGroup;

  const producerConnectionNodes = providerHealth.children.filter((c) => c.key === "sportsradar_producer_connection");
  assert.equal(producerConnectionNodes.length, 1, "only one instance, never both");
  assert.equal((producerConnectionNodes[0] as NormalizedLeaf).status, "delayed", "the odds_streamer instance was picked, not the socket one (status differs between the two fixtures specifically to prove which was chosen)");
});

test("Provider Health: status reflects a real down/delayed child among otherwise-ok checks", () => {
  const entries = [
    rawCheck({ service: "socket", key: "socket_connections", status: "ok" }),
    rawCheck({ service: "socket", key: "sr_bet_settlement", status: "ok" }),
    rawCheck({ service: "socket", key: "sr_bet_settlement_processing", status: "down" }),
    rawCheck({ service: "socket", key: "sr_tier1_settlement_sla", status: "ok" }),
    rawCheck({ service: "odds_streamer", key: "partner_odds_feed_relay", status: "ok" }),
    rawCheck({ service: "odds_streamer", key: "sportsradar_producer_connection", status: "ok" }),
  ];
  const result = normalizeServiceHealth(buildRaw(entries), SPORTSBOOK_STUB);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;
  const providerHealth = sportsbook.checks.find((c) => c.key === "provider_health") as NormalizedGroup;

  assert.equal(providerHealth.status, "down");
  assert.equal(sportsbook.status, "down", "the whole Sportsbook category reflects Provider Health's down status too");
});

test("Provider Health: missing entries are simply omitted, not fabricated (empty raw data)", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;
  const providerHealth = sportsbook.checks.find((c) => c.key === "provider_health") as NormalizedGroup;
  assert.equal(providerHealth.children.length, 0);
  assert.equal(providerHealth.status, "unknown");
});

test("Sportsbook: sportsradar_live_tracker and sportsradar_back_office appear as flat top-level rows, clearly separate from Provider Health's 6 real checks", () => {
  const liveTracker = rawCheck({
    service: "admin-api",
    key: "sportsradar_live_tracker",
    label: "SportRadar Live Match Tracker / Stats Widget",
    status: "pending_setup",
    note: "Frontend-embedded third-party widget (arenav3frontend) — no backend call in these services to monitor.",
    flows: [],
  });
  const backOffice = rawCheck({
    service: "admin-api",
    key: "sportsradar_back_office",
    label: "SportRadar Back Office Access",
    status: "pending_setup",
    note: "SportRadar's own admin panel, not proxied through any of our services — would need a dedicated uptime probe of their URL if this is wanted.",
    flows: [],
  });
  const socketConnections = rawCheck({ service: "socket", key: "socket_connections", status: "ok" });
  const result = normalizeServiceHealth(buildRaw([liveTracker, backOffice, socketConnections]), SPORTSBOOK_STUB);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;

  assert.deepEqual(
    sportsbook.checks.map((c) => c.key),
    ["our_connection", "provider_health", "sportsradar_live_tracker", "sportsradar_back_office"]
  );
  const providerHealth = sportsbook.checks.find((c) => c.key === "provider_health") as NormalizedGroup;
  assert.equal(
    providerHealth.children.find((c) => c.key === "sportsradar_live_tracker" || c.key === "sportsradar_back_office"),
    undefined,
    "the two pending entries never end up inside Provider Health's children"
  );

  const liveTrackerNode = sportsbook.checks.find((c) => c.key === "sportsradar_live_tracker") as NormalizedLeaf;
  assert.equal(liveTrackerNode.status, "pending_setup");
  assert.equal(
    liveTrackerNode.sourceNote,
    "Frontend-embedded third-party widget (arenav3frontend) — no backend call in these services to monitor."
  );
});

test("Sportsbook: category status still reflects Provider Health/Our Connection -- the two pending_setup rows don't drag it down", () => {
  const liveTracker = rawCheck({ service: "admin-api", key: "sportsradar_live_tracker", status: "pending_setup", flows: [] });
  const backOffice = rawCheck({ service: "admin-api", key: "sportsradar_back_office", status: "pending_setup", flows: [] });
  const socketConnections = rawCheck({ service: "socket", key: "socket_connections", status: "ok" });
  const result = normalizeServiceHealth(buildRaw([liveTracker, backOffice, socketConnections]), SPORTSBOOK_STUB);
  const sportsbook = result.categories.find((c) => c.key === "sportsbook")!;
  assert.equal(sportsbook.status, "ok");
});

test("KYC & Risk and Comms: not_integrated only when none of their real entries are present at all", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  const kyc = result.categories.find((c) => c.key === "kyc_risk")!;
  const comms = result.categories.find((c) => c.key === "comms")!;
  assert.equal(kyc.status, "not_integrated");
  assert.equal(kyc.checks.length, 0);
  assert.equal(comms.status, "not_integrated");
  assert.equal(comms.checks.length, 0);
});

// --- KYC & Risk (real entries wired in 2026-09-23) ---------------------

test("KYC & Risk: includes both real frogo_risk_signal entries (investigated: different labels + different slowMs -- two distinct real checks, not a duplicate), plus frogo and kyc_shifty_pro", () => {
  const frogoPayment = rawCheck({ service: "payment", key: "frogo_risk_signal", label: "Frogo Risk Scoring", status: "unknown" });
  const frogoSocket = rawCheck({ service: "socket", key: "frogo_risk_signal", label: "Frogo Risk Scoring (Bet Settlement)", status: "unknown" });
  const frogoIntelligence = rawCheck({
    service: "admin-api",
    key: "frogo",
    label: "Frogo Risk Intelligence",
    status: "unknown",
    flows: [rawCheck({ key: "risk_signal", label: "Deposit / Withdrawal Risk Scoring", status: "unknown" })],
  });
  const kycShiftyPro = rawCheck({
    service: "admin-api",
    key: "kyc_shifty_pro",
    label: "KYC (Shifty Pro)",
    status: "pending_setup",
    note: "Future integration per requirements — no Shifty Pro (or any KYC provider) integration exists in code yet.",
    flows: [],
  });
  const result = normalizeServiceHealth(buildRaw([frogoPayment, frogoSocket, frogoIntelligence, kycShiftyPro]), SPORTSBOOK_STUB);
  const kyc = result.categories.find((c) => c.key === "kyc_risk")!;

  assert.equal(kyc.realCoverage, "partial");
  assert.deepEqual(
    kyc.checks.map((c) => c.key),
    ["frogo_risk_signal", "frogo_risk_signal", "frogo", "kyc_shifty_pro"]
  );
  // Both frogo_risk_signal entries present, clearly labeled differently --
  // neither dropped, per the "different -> show both" rule.
  const [paymentNode, socketNode] = kyc.checks as NormalizedLeaf[];
  assert.equal(paymentNode.label, "Frogo Risk Scoring");
  assert.equal(socketNode.label, "Frogo Risk Scoring (Bet Settlement)");
});

test("KYC & Risk: kyc_shifty_pro's real sourceNote is the explanation, not a generic placeholder", () => {
  const kycShiftyPro = rawCheck({
    service: "admin-api",
    key: "kyc_shifty_pro",
    label: "KYC (Shifty Pro)",
    status: "pending_setup",
    note: "Future integration per requirements — no Shifty Pro (or any KYC provider) integration exists in code yet.",
    flows: [],
  });
  const result = normalizeServiceHealth(buildRaw([kycShiftyPro]), SPORTSBOOK_STUB);
  const kyc = result.categories.find((c) => c.key === "kyc_risk")!;
  const node = kyc.checks.find((c) => c.key === "kyc_shifty_pro") as NormalizedLeaf;
  assert.equal(node.status, "pending_setup");
  assert.equal(node.sourceNote, "Future integration per requirements — no Shifty Pro (or any KYC provider) integration exists in code yet.");
});

// --- Comms (real entries wired in 2026-09-23) --------------------------

test("Comms: includes wati_messaging, sms (2 flows), otp (1 flow), and calling_system (pending_setup)", () => {
  const wati = rawCheck({ service: "payment", key: "wati_messaging", label: "Wati (WhatsApp)", status: "unknown" });
  const sms = rawCheck({
    service: "admin-api",
    key: "sms",
    label: "SMS Delivery",
    status: "unknown",
    flows: [
      rawCheck({ key: "2factor", label: "SMS OTP (2factor.in)", status: "unknown" }),
      rawCheck({ key: "msg91_widget", label: "MSG91 Widget Verify (Login)", status: "unknown" }),
    ],
  });
  const otp = rawCheck({
    service: "admin-api",
    key: "otp",
    label: "OTP Delivery",
    status: "unknown",
    flows: [rawCheck({ key: "email", label: "Email OTP", status: "unknown" })],
  });
  const callingSystem = rawCheck({
    service: "admin-api",
    key: "calling_system",
    label: "Calling System",
    status: "pending_setup",
    note: "Only a CRM agent-attribution endpoint exists (CallingAgentController.js) — no actual telephony/dialer integration to monitor.",
    flows: [],
  });
  const result = normalizeServiceHealth(buildRaw([wati, sms, otp, callingSystem]), SPORTSBOOK_STUB);
  const comms = result.categories.find((c) => c.key === "comms")!;

  assert.equal(comms.realCoverage, "partial");
  assert.deepEqual(comms.checks.map((c) => c.key), ["wati_messaging", "sms", "otp", "calling_system"]);

  const smsGroup = comms.checks.find((c) => c.key === "sms") as NormalizedGroup;
  assert.equal(smsGroup.kind, "group");
  assert.equal(smsGroup.children.length, 2);

  const otpGroup = comms.checks.find((c) => c.key === "otp") as NormalizedGroup;
  assert.equal(otpGroup.children.length, 1);

  const callingSystemNode = comms.checks.find((c) => c.key === "calling_system") as NormalizedLeaf;
  assert.equal(
    callingSystemNode.sourceNote,
    "Only a CRM agent-attribution endpoint exists (CallingAgentController.js) — no actual telephony/dialer integration to monitor."
  );
});

test("Other: business_flow_deposit renders steps[] in original order, never sorted", () => {
  const deposit = rawCheck({
    key: "business_flow_deposit",
    label: "Deposit → Wallet Credit",
    status: "unknown",
    steps: [
      rawCheck({ key: "callback_received", status: "unknown" }),
      rawCheck({ key: "transaction_updated", status: "unknown" }),
      rawCheck({ key: "balance_updated", status: "unknown" }),
      rawCheck({ key: "wagering_audit", status: "unknown" }),
    ],
  });
  const result = normalizeServiceHealth(buildRaw([deposit]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;
  const group = other.checks.find((c) => c.key === "business_flow_deposit") as NormalizedGroup;
  assert.deepEqual(
    group.children.map((c) => c.key),
    ["callback_received", "transaction_updated", "balance_updated", "wagering_audit"]
  );
});

test("Other: the socket entry is included with an investigation note, method n/a preserved", () => {
  const socket = rawCheck({
    service: "socket",
    key: "socket",
    label: "Socket Service",
    method: "n/a",
    status: "down",
    lastError: "Request failed with status code 404",
  });
  const result = normalizeServiceHealth(buildRaw([socket]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;
  const socketNode = other.checks.find((c) => c.key === "socket") as NormalizedLeaf;
  assert.equal(socketNode.method, "n/a");
  assert.equal(socketNode.status, "down");
  assert.ok(socketNode.note, "the socket entry should carry an investigation note");
  assert.ok(socketNode.note!.includes("404"));
});

test("Other: category status is worst-of (deposit flow unknown, socket down) -> down", () => {
  const deposit = rawCheck({ key: "business_flow_deposit", status: "unknown", steps: [rawCheck({ status: "unknown" })] });
  const socket = rawCheck({ service: "socket", key: "socket", method: "n/a", status: "down" });
  const result = normalizeServiceHealth(buildRaw([deposit, socket]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;
  assert.equal(other.status, "down");
});

test("Other: maps the real sports_bet entry (currently down, 403) as a plain leaf, no fabricated annotation", () => {
  const sportsBet = rawCheck({
    service: "sports_bet",
    key: "sports_bet",
    label: "Sports Bet Service",
    method: "n/a",
    status: "down",
    lastFailureAt: "2026-09-23T04:39:56.152Z",
    lastError: "Request failed with status code 403",
  });
  const result = normalizeServiceHealth(buildRaw([sportsBet]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;
  const node = other.checks.find((c) => c.key === "sports_bet") as NormalizedLeaf;
  assert.ok(node, "sports_bet is no longer invisible in the Other category");
  assert.equal(node.kind, "leaf");
  assert.equal(node.method, "n/a");
  assert.equal(node.status, "down");
  assert.equal(node.lastError, "Request failed with status code 403");
  assert.equal(node.note, undefined, "unlike the old socket entry, no investigation has been done on this one -- nothing fabricated");
});

test("Other: category status reflects sports_bet being down, even alongside an unrelated unknown business flow", () => {
  const deposit = rawCheck({ key: "business_flow_deposit", status: "unknown", steps: [rawCheck({ status: "unknown" })] });
  const sportsBet = rawCheck({ service: "sports_bet", key: "sports_bet", method: "n/a", status: "down" });
  const result = normalizeServiceHealth(buildRaw([deposit, sportsBet]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;
  assert.equal(other.status, "down");
  assert.equal(other.checks.length, 2);
});

test("Other: sports_bet under the wrong service is not picked up (composite lookup, same as every other entry)", () => {
  const decoy = rawCheck({ service: "some_other_service", key: "sports_bet", status: "down" });
  const result = normalizeServiceHealth(buildRaw([decoy]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;
  assert.equal(other.checks.find((c) => c.key === "sports_bet"), undefined);
});

test("Other: content_creator_system appears as a pending_setup leaf alongside business_flow_deposit and sports_bet, with its real sourceNote", () => {
  const deposit = rawCheck({ key: "business_flow_deposit", status: "unknown", steps: [rawCheck({ status: "unknown" })] });
  const sportsBet = rawCheck({ service: "sports_bet", key: "sports_bet", method: "n/a", status: "down" });
  const contentCreator = rawCheck({
    service: "admin-api",
    key: "content_creator_system",
    label: "Content Creator System",
    status: "pending_setup",
    note: "No content-creator service or endpoint exists in code — only a passive attribution field on user records.",
    flows: [],
  });
  const result = normalizeServiceHealth(buildRaw([deposit, sportsBet, contentCreator]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;

  assert.deepEqual(
    other.checks.map((c) => c.key),
    ["business_flow_deposit", "sports_bet", "content_creator_system"]
  );
  const node = other.checks.find((c) => c.key === "content_creator_system") as NormalizedLeaf;
  assert.equal(node.status, "pending_setup");
  assert.equal(
    node.sourceNote,
    "No content-creator service or endpoint exists in code — only a passive attribution field on user records."
  );
});

// --- Composite identity (service+key) ------------------------------
//
// Real duplicate-key examples confirmed live 2026-09-23 against the
// 40-entry response: `key` alone collides for two genuinely different
// pairs of real entries. findEntry (normalize.ts) must disambiguate both.

test("findEntry: real duplicate key 'sportsradar_producer_connection' -- same label, different service, must not collide", () => {
  const socketVariant = rawCheck({
    service: "socket",
    key: "sportsradar_producer_connection",
    label: "SportRadar Producer Connection",
    method: "poll",
    status: "ok",
    responseTimeMs: 2,
  });
  const oddsStreamerVariant = rawCheck({
    service: "odds_streamer",
    key: "sportsradar_producer_connection",
    label: "SportRadar Producer Connection",
    method: "poll",
    status: "ok",
    responseTimeMs: 2,
  });
  const data = [socketVariant, oddsStreamerVariant];

  assert.equal(findEntry(data, "socket", "sportsradar_producer_connection"), socketVariant);
  assert.equal(findEntry(data, "odds_streamer", "sportsradar_producer_connection"), oddsStreamerVariant);
  assert.notEqual(
    findEntry(data, "socket", "sportsradar_producer_connection"),
    findEntry(data, "odds_streamer", "sportsradar_producer_connection")
  );
});

test("findEntry: real duplicate key 'frogo_risk_signal' -- different service AND different label, must not collide", () => {
  const paymentVariant = rawCheck({
    service: "payment",
    key: "frogo_risk_signal",
    label: "Frogo Risk Scoring",
    method: "response",
    status: "unknown",
  });
  const socketVariant = rawCheck({
    service: "socket",
    key: "frogo_risk_signal",
    label: "Frogo Risk Scoring (Bet Settlement)",
    method: "response",
    status: "unknown",
  });
  const data = [paymentVariant, socketVariant];

  assert.equal(findEntry(data, "payment", "frogo_risk_signal")!.label, "Frogo Risk Scoring");
  assert.equal(findEntry(data, "socket", "frogo_risk_signal")!.label, "Frogo Risk Scoring (Bet Settlement)");
});

test("findEntry: a key that exists under a different service than requested is not found -- no silent key-only fallback", () => {
  const data = [rawCheck({ service: "socket", key: "sportsradar_producer_connection", status: "ok" })];
  assert.equal(findEntry(data, "odds_streamer", "sportsradar_producer_connection"), undefined);
});

test("buildPayments still finds pay777 correctly even when a same-keyed entry exists under a different service (regression guard)", () => {
  // Not a real observed collision for pay777 specifically, but proves the
  // composite lookup generalizes -- a decoy under the wrong service must
  // never satisfy PAYMENT_ENTRIES' { service: "payment", key: "pay777" }.
  const decoy = rawCheck({ service: "some_other_service", key: "pay777", label: "Decoy", status: "down" });
  const real = rawCheck({ service: "payment", key: "pay777", label: "Pay777", status: "delayed", flows: [rawCheck({ status: "delayed" })] });
  const result = normalizeServiceHealth(buildRaw([decoy, real]), SPORTSBOOK_STUB);
  const payments = result.categories.find((c) => c.key === "payments")!;
  assert.equal(payments.checks.length, 1, "the decoy under the wrong service is not picked up");
  assert.equal((payments.checks[0] as NormalizedGroup).label, "Pay777");
});

// --- sourceNote (Satyam's own raw note, kept distinct from our `note`) --

test("toLeaf: a raw entry's note becomes sourceNote, distinct from our own note field (real sportsradar_live_tracker shape)", () => {
  const raw = rawCheck({
    service: "admin-api",
    key: "sportsradar_live_tracker",
    label: "SportRadar Live Match Tracker / Stats Widget",
    category: "sportsradar",
    status: "pending_setup",
    note: "Frontend-embedded third-party widget (arenav3frontend) — no backend call in these services to monitor.",
  });
  const leaf = toLeaf(raw);
  assert.equal(leaf.status, "pending_setup");
  assert.equal(
    leaf.sourceNote,
    "Frontend-embedded third-party widget (arenav3frontend) — no backend call in these services to monitor."
  );
  assert.equal(leaf.note, undefined, "toLeaf itself never sets our own `note` -- only call sites that annotate deliberately do (e.g. buildOther's socket handling)");
});

test("toLeaf: no sourceNote when the raw entry carries no note (the common case)", () => {
  const raw = rawCheck({ key: "pay777", status: "delayed" });
  const leaf = toLeaf(raw);
  assert.equal(leaf.sourceNote, undefined);
});

// Regression: `flows: []` (an empty array) is a real shape (confirmed
// live 2026-09-23 on internal_back_office and all 5 pending_setup
// entries) -- toNode used to treat any truthy `entry.flows`, including an
// empty array, as "this is a group," discarding the entry's own real
// status (e.g. "pending_setup") in favor of aggregateStatus([]) ==
// "unknown" on a zero-child group. Found while wiring kyc_shifty_pro/
// calling_system in via toNode for the first time.
test("toNode: an entry with flows: [] (empty, not absent) is a leaf, not a zero-child group -- real status preserved", () => {
  const raw = rawCheck({
    service: "admin-api",
    key: "kyc_shifty_pro",
    label: "KYC (Shifty Pro)",
    status: "pending_setup",
    note: "Future integration per requirements — no Shifty Pro (or any KYC provider) integration exists in code yet.",
    flows: [],
  });
  const node = toNode(raw, "2026-09-23T05:56:45.698Z");
  assert.equal(node.kind, "leaf", "not wrapped in a group just because flows is present, even though it's empty");
  assert.equal(node.status, "pending_setup", "not silently downgraded to 'unknown' via an empty-children aggregateStatus");
});

test("toNode: an entry with steps: [] (empty, not absent) is a leaf too, same as flows", () => {
  const raw = rawCheck({ key: "some_entry", status: "ok", steps: [] });
  const node = toNode(raw, "2026-09-23T05:56:45.698Z");
  assert.equal(node.kind, "leaf");
  assert.equal(node.status, "ok");
});

test("Other: our own socket investigation note and a hypothetical raw sourceNote never collide (both can coexist)", () => {
  // Not a real observed combination (the real socket entry today carries
  // no raw note), but proves the two fields are independent -- if Satyam
  // ever adds his own note to this entry, our own annotation still shows
  // up unchanged and separately.
  const socket = rawCheck({
    service: "socket",
    key: "socket",
    method: "n/a",
    status: "down",
    note: "Hypothetical raw explanation from the source.",
  });
  const result = normalizeServiceHealth(buildRaw([socket]), SPORTSBOOK_STUB);
  const other = result.categories.find((c) => c.key === "other")!;
  const socketNode = other.checks.find((c) => c.key === "socket") as NormalizedLeaf;
  assert.equal(socketNode.sourceNote, "Hypothetical raw explanation from the source.");
  assert.ok(socketNode.note?.includes("404"), "our own annotation is untouched and still present");
  assert.notEqual(socketNode.note, socketNode.sourceNote);
});

test("toGroup: a parent entry's own note (not a child's) becomes the group's sourceNote", () => {
  const raw: RawEntry = rawCheck({
    key: "hypothetical_group",
    label: "Hypothetical Group",
    note: "Explanation on the parent itself, not on any child.",
    status: "ok",
  });
  const group = toGroup(raw, [rawCheck({ key: "child", status: "ok" })], "2026-09-23T04:39:56.242Z");
  assert.equal(group.sourceNote, "Explanation on the parent itself, not on any child.");
});

// --- pending_setup passthrough (real 40-entry examples) ----------------

test("normalizeServiceHealth: a real pending_setup leaf (kyc_shifty_pro-shaped) passes its status through unchanged", () => {
  const kyc = rawCheck({
    service: "admin-api",
    key: "kyc_shifty_pro",
    label: "KYC (Shifty Pro)",
    category: "kyc",
    note: "Future integration per requirements — no Shifty Pro (or any KYC provider) integration exists in code yet.",
    status: "pending_setup",
    flows: [],
  });
  // pending_setup entries aren't looked up by any category builder today
  // (none of the 5 real keys are in PAYMENT_ENTRIES/CRM/notifications/
  // casino/business_flow/socket) -- toLeaf is exercised directly here,
  // same as the sourceNote tests above, since there's no real category
  // path to it yet.
  const leaf = toLeaf(kyc);
  assert.equal(leaf.status, "pending_setup");
  assert.equal(leaf.sourceNote, "Future integration per requirements — no Shifty Pro (or any KYC provider) integration exists in code yet.");
});
