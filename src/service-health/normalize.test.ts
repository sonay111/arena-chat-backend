import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeServiceHealth, findEntry, toLeaf, toGroup } from "./normalize.js";
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

test("Sportsbook: passed through untouched from the injected sportsbook category (not derived from /service-health at all)", () => {
  const st8 = rawCheck({ service: "casino", key: "st8_casino_callbacks", status: "ok" });
  const result = normalizeServiceHealth(buildRaw([st8]), SPORTSBOOK_STUB);
  assert.deepEqual(result.categories.find((c) => c.key === "sportsbook"), SPORTSBOOK_STUB);
});

test("KYC & Risk and Comms: always not_integrated regardless of what's in the raw response", () => {
  const result = normalizeServiceHealth(buildRaw([]), SPORTSBOOK_STUB);
  const kyc = result.categories.find((c) => c.key === "kyc_risk")!;
  const comms = result.categories.find((c) => c.key === "comms")!;
  assert.equal(kyc.status, "not_integrated");
  assert.equal(kyc.checks.length, 0);
  assert.equal(comms.status, "not_integrated");
  assert.equal(comms.checks.length, 0);
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
