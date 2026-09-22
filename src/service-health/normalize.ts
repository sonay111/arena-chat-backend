import type {
  RawCheck,
  RawEntry,
  RawServiceHealthResponse,
  NormalizedLeaf,
  NormalizedGroup,
  NormalizedNode,
  NormalizedCategory,
  NormalizedServiceHealth,
} from "./types.js";
import { aggregateStatus } from "./aggregate.js";

function toLeaf(raw: RawCheck): NormalizedLeaf {
  return {
    kind: "leaf",
    key: raw.key,
    label: raw.label,
    method: raw.method,
    status: raw.status,
    lastSuccessAt: raw.lastSuccessAt,
    lastFailureAt: raw.lastFailureAt,
    lastError: raw.lastError,
    responseTimeMs: raw.responseTimeMs,
  };
}

// Used for both flows[] (payment gateways, CRM, notifications) and
// steps[] (the deposit business flow) -- same shape, different field name
// on the raw entry, same aggregation rule either way.
function toGroup(entry: RawEntry, children: RawCheck[]): NormalizedGroup {
  const normalizedChildren = children.map(toLeaf);
  return {
    kind: "group",
    key: entry.key,
    label: entry.label,
    status: aggregateStatus(normalizedChildren.map((c) => c.status)),
    children: normalizedChildren,
  };
}

// A group's own children array is never re-sorted here or anywhere in
// this module -- callers pass entry.flows/entry.steps through in the
// order the CRM returned them, which matters most for business_flow_deposit
// (an ordered causal chain, not an unordered set of checks).
function toNode(entry: RawEntry): NormalizedNode {
  if (entry.flows) return toGroup(entry, entry.flows);
  if (entry.steps) return toGroup(entry, entry.steps);
  return toLeaf(entry);
}

function findByKey(data: RawEntry[], key: string): RawEntry | undefined {
  return data.find((entry) => entry.key === key);
}

function statusOf(node: NormalizedNode): NormalizedNode["status"] {
  return node.status;
}

// The 8 named gateways, exact match, fully real today -- plus
// ocr_deposit_slip (category "ocr" in the raw response, not one of the 8
// gateways) as a 9th entry: it's payment-domain (deposit slip
// verification) but doesn't fit CRM/Notifications/Casino/Other, so it
// rides along here rather than being silently dropped (confirmed live
// 2026-09-22 that the original mapping omitted it entirely).
const PAYMENT_KEYS = [
  "pay777",
  "paytru",
  "paybitra",
  "dypaytech",
  "rolezpay",
  "payelu",
  "digiceylon",
  "hero",
  "ocr_deposit_slip",
];

function buildPayments(data: RawEntry[]): NormalizedCategory {
  const checks = PAYMENT_KEYS.map((key) => findByKey(data, key))
    .filter((entry): entry is RawEntry => entry !== undefined)
    .map(toNode);

  return {
    key: "payments",
    label: "Payments",
    status: aggregateStatus(checks.map(statusOf)),
    realCoverage: "full",
    checks,
  };
}

function buildCrm(data: RawEntry[]): NormalizedCategory {
  const entry = findByKey(data, "crm");
  const checks = entry?.flows ? entry.flows.map(toLeaf) : [];

  return {
    key: "crm",
    label: "CRM",
    status: entry ? aggregateStatus(checks.map((c) => c.status)) : "not_integrated",
    realCoverage: entry ? "full" : "none",
    checks,
  };
}

// Two distinct real sources under the notifications category -- kept as
// two named groups (not flattened into one flow list) so a caller can
// still tell OneSignal apart from in-app delivery.
const NOTIFICATION_SOURCE_KEYS = ["onesignal", "notifications"];

function buildNotifications(data: RawEntry[]): NormalizedCategory {
  const checks = NOTIFICATION_SOURCE_KEYS.map((key) => findByKey(data, key))
    .filter((entry): entry is RawEntry => entry !== undefined)
    .map(toNode);

  return {
    key: "notifications",
    label: "Notifications",
    status: checks.length > 0 ? aggregateStatus(checks.map(statusOf)) : "not_integrated",
    realCoverage:
      checks.length === NOTIFICATION_SOURCE_KEYS.length ? "full" : checks.length > 0 ? "partial" : "none",
    checks,
  };
}

function buildCasino(data: RawEntry[]): NormalizedCategory {
  const entry = findByKey(data, "st8_casino_callbacks");
  const checks = entry ? [toLeaf(entry)] : [];

  return {
    key: "casino",
    label: "Casino",
    status: entry ? entry.status : "not_integrated",
    realCoverage: entry ? "partial" : "none",
    note: entry
      ? "Only ST8 Casino Callbacks is backed by a real check today -- other casino checks the old mock expected are not yet integrated."
      : "Nothing real exists for this category yet.",
    checks,
  };
}

function notIntegratedCategory(key: string, label: string): NormalizedCategory {
  return {
    key,
    label,
    status: "not_integrated",
    realCoverage: "none",
    note: "Nothing real exists for this category yet.",
    checks: [],
  };
}

function buildOther(data: RawEntry[]): NormalizedCategory {
  const checks: NormalizedNode[] = [];

  const depositFlow = findByKey(data, "business_flow_deposit");
  if (depositFlow?.steps) {
    checks.push(toGroup(depositFlow, depositFlow.steps));
  }

  // Synthetic-entry handling: method "n/a" marks a check against a
  // service we can't reach in the normal request/response sense (as
  // opposed to a real request that came back unhealthy) -- passed through
  // as-is, plus our own investigation finding attached as a note rather
  // than silently trusting the raw "down".
  const socketEntry = findByKey(data, "socket");
  if (socketEntry) {
    checks.push({
      ...toLeaf(socketEntry),
      note:
        "Reports down via HTTP 404. Investigated 2026-09-22: our own client is connected to this same odds feed right now, and curling the real path directly (stgodds.../v1/odds/socket.io) returns 401 (auth required), not 404 -- only nearby wrong-path variants (missing /v1, missing /odds, an added trailing slash) return a genuine 404. Most likely a misconfigured check URL on Satyam's side, not a real outage -- worth reporting back to him rather than treating as a confirmed incident.",
    });
  }

  return {
    key: "other",
    label: "Other",
    status: aggregateStatus(checks.map(statusOf)),
    realCoverage: checks.length > 0 ? "full" : "none",
    checks,
  };
}

export function normalizeServiceHealth(
  raw: RawServiceHealthResponse,
  sportsbook: NormalizedCategory
): NormalizedServiceHealth {
  return {
    checkedAt: raw.checkedAt,
    categories: [
      buildPayments(raw.data),
      buildCrm(raw.data),
      buildNotifications(raw.data),
      buildCasino(raw.data),
      sportsbook,
      notIntegratedCategory("kyc_risk", "KYC & Risk"),
      notIntegratedCategory("comms", "Comms"),
      buildOther(raw.data),
    ],
  };
}
