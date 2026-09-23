import type {
  RawCheck,
  RawEntry,
  RawServiceHealthResponse,
  NormalizedLeaf,
  NormalizedGroup,
  NormalizedNode,
  NormalizedCategory,
  NormalizedServiceHealth,
  StatusValue,
} from "./types.js";
import { aggregateStatus } from "./aggregate.js";

export function toLeaf(raw: RawCheck): NormalizedLeaf {
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
    ...(raw.note ? { sourceNote: raw.note } : {}),
  };
}

// Compact "1d 22h ago" / "3h 12m ago" / "45m ago" / "just now" -- matches
// how far back a check last succeeded/failed, without needing a full date.
function humanizeAge(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (minutes < 1) return "just now";
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  return `${minutes}m ago`;
}

// Most-recent-wins across every descendant leaf, recursing through nested
// groups (none exist in real data today, but the type is recursive).
function latestTimestamp(children: NormalizedNode[], field: "lastSuccessAt" | "lastFailureAt"): string | null {
  let latest: string | null = null;
  for (const child of children) {
    const candidate = child.kind === "leaf" ? child[field] : latestTimestamp(child.children, field);
    if (candidate && (!latest || new Date(candidate).getTime() > new Date(latest).getTime())) {
      latest = candidate;
    }
  }
  return latest;
}

// The first leaf, in original order, at the same severity as the group's
// own worst-of-children status -- same child aggregateStatus itself would
// point to. Recurses into a nested group only if that group's own status
// matches (its worst leaf is somewhere inside it).
function findResponsibleLeaf(children: NormalizedNode[], targetStatus: StatusValue): NormalizedLeaf | undefined {
  for (const child of children) {
    if (child.status !== targetStatus) continue;
    if (child.kind === "leaf") return child;
    const nested = findResponsibleLeaf(child.children, targetStatus);
    if (nested) return nested;
  }
  return undefined;
}

function describeIssue(children: NormalizedNode[], status: StatusValue, checkedAt: string): string | null {
  if (status !== "delayed" && status !== "down") return null;
  const leaf = findResponsibleLeaf(children, status);
  if (!leaf) return null;

  const ageText = leaf.lastSuccessAt
    ? `last succeeded ${humanizeAge(new Date(checkedAt).getTime() - new Date(leaf.lastSuccessAt).getTime())}`
    : "no successful check recorded";
  return `${leaf.label} ${status} — ${ageText}`;
}

// Used for both flows[] (payment gateways, notifications) and steps[]
// (the deposit business flow) -- same shape, different field name on the
// raw entry, same aggregation rule either way. checkedAt is Satyam's own
// "as of" timestamp for this response, not our wall clock -- it's what
// every child's own age is measured against, so the issue detail's "last
// succeeded Nd Nh ago" stays consistent with that.
export function toGroup(entry: RawEntry, children: RawCheck[], checkedAt: string): NormalizedGroup {
  const normalizedChildren = children.map(toLeaf);
  const status = aggregateStatus(normalizedChildren.map((c) => c.status));
  return {
    kind: "group",
    key: entry.key,
    label: entry.label,
    status,
    lastSuccessAt: latestTimestamp(normalizedChildren, "lastSuccessAt"),
    lastFailureAt: latestTimestamp(normalizedChildren, "lastFailureAt"),
    responseTimeMs: null,
    issueDetail: describeIssue(normalizedChildren, status, checkedAt),
    children: normalizedChildren,
    ...(entry.note ? { sourceNote: entry.note } : {}),
  };
}

// A group's own children array is never re-sorted here or anywhere in
// this module -- callers pass entry.flows/entry.steps through in the
// order the CRM returned them, which matters most for business_flow_deposit
// (an ordered causal chain, not an unordered set of checks).
function toNode(entry: RawEntry, checkedAt: string): NormalizedNode {
  if (entry.flows) return toGroup(entry, entry.flows, checkedAt);
  if (entry.steps) return toGroup(entry, entry.steps, checkedAt);
  return toLeaf(entry);
}

// `key` alone is not a unique identity in this API -- see RawEntry's
// comment in types.ts for the two confirmed real collisions
// (sportsradar_producer_connection across service "socket"/"odds_streamer",
// frogo_risk_signal across service "payment"/"socket" with different
// labels). Every lookup in this module goes through here, service+key
// together, so two distinct real checks can never silently collide.
export function findEntry(data: RawEntry[], service: string, key: string): RawEntry | undefined {
  return data.find((entry) => entry.service === service && entry.key === key);
}

function statusOf(node: NormalizedNode): NormalizedNode["status"] {
  return node.status;
}

// The 8 named gateways, exact match, fully real today -- plus
// ocr_deposit_slip (category "ocr" in the raw response, not one of the 8
// gateways) as a 9th entry: it's payment-domain (deposit slip
// verification) but doesn't fit CRM/Notifications/Casino/Other, so it
// rides along here rather than being silently dropped (confirmed live
// 2026-09-22 that the original mapping omitted it entirely). All 9 are
// service "payment" -- named explicitly per-entry (not a bare key list)
// so this reads the same composite-identity way as every other lookup.
const PAYMENT_ENTRIES: Array<{ service: string; key: string }> = [
  { service: "payment", key: "pay777" },
  { service: "payment", key: "paytru" },
  { service: "payment", key: "paybitra" },
  { service: "payment", key: "dypaytech" },
  { service: "payment", key: "rolezpay" },
  { service: "payment", key: "payelu" },
  { service: "payment", key: "digiceylon" },
  { service: "payment", key: "hero" },
  { service: "payment", key: "ocr_deposit_slip" },
];

function buildPayments(data: RawEntry[], checkedAt: string): NormalizedCategory {
  const checks = PAYMENT_ENTRIES.map(({ service, key }) => findEntry(data, service, key))
    .filter((entry): entry is RawEntry => entry !== undefined)
    .map((entry) => toNode(entry, checkedAt));

  return {
    key: "payments",
    label: "Payments",
    status: aggregateStatus(checks.map(statusOf)),
    realCoverage: "full",
    checks,
  };
}

// Wrapped in a group the same way every other flows[]/steps[] source is
// (payment gateways, business_flow_deposit, OneSignal/In-App) -- CRM used
// to flatten its flows directly onto the category with no parent row,
// which meant no single place to see its own rolled-up lastSuccessAt/
// issueDetail without looking at all 4 flows individually.
function buildCrm(data: RawEntry[], checkedAt: string): NormalizedCategory {
  const entry = findEntry(data, "admin-api", "crm");
  const checks = entry?.flows ? [toGroup(entry, entry.flows, checkedAt)] : [];

  return {
    key: "crm",
    label: "CRM",
    status: entry ? aggregateStatus(checks.map(statusOf)) : "not_integrated",
    realCoverage: entry ? "full" : "none",
    checks,
  };
}

// Two distinct real sources under the notifications category -- kept as
// two named groups (not flattened into one flow list) so a caller can
// still tell OneSignal apart from in-app delivery. Both service "admin-api".
const NOTIFICATION_SOURCE_ENTRIES: Array<{ service: string; key: string }> = [
  { service: "admin-api", key: "onesignal" },
  { service: "admin-api", key: "notifications" },
];

function buildNotifications(data: RawEntry[], checkedAt: string): NormalizedCategory {
  const checks = NOTIFICATION_SOURCE_ENTRIES.map(({ service, key }) => findEntry(data, service, key))
    .filter((entry): entry is RawEntry => entry !== undefined)
    .map((entry) => toNode(entry, checkedAt));

  return {
    key: "notifications",
    label: "Notifications",
    status: checks.length > 0 ? aggregateStatus(checks.map(statusOf)) : "not_integrated",
    realCoverage:
      checks.length === NOTIFICATION_SOURCE_ENTRIES.length ? "full" : checks.length > 0 ? "partial" : "none",
    checks,
  };
}

function buildCasino(data: RawEntry[]): NormalizedCategory {
  const entry = findEntry(data, "casino", "st8_casino_callbacks");
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

function buildOther(data: RawEntry[], checkedAt: string): NormalizedCategory {
  const checks: NormalizedNode[] = [];

  const depositFlow = findEntry(data, "payment", "business_flow_deposit");
  if (depositFlow?.steps) {
    checks.push(toGroup(depositFlow, depositFlow.steps, checkedAt));
  }

  // Real, currently-failing check (confirmed live 2026-09-23: status
  // down, method "n/a", "Request failed with status code 403") -- no
  // investigation done on this one yet (unlike the old socket entry
  // below), so no annotation added here beyond what's real. Plain toLeaf,
  // same composite (service, key) lookup as everything else.
  const sportsBetEntry = findEntry(data, "sports_bet", "sports_bet");
  if (sportsBetEntry) {
    checks.push(toLeaf(sportsBetEntry));
  }

  // Synthetic-entry handling: method "n/a" marks a check against a
  // service we can't reach in the normal request/response sense (as
  // opposed to a real request that came back unhealthy) -- passed through
  // as-is, plus our own investigation finding attached as a note rather
  // than silently trusting the raw "down".
  //
  // NOTE (2026-09-23): this key+service pair no longer appears in the
  // real 40-entry response at all -- the old "Socket Service" check
  // (service "socket", key "socket") seems to have been replaced by a new
  // "sports_bet" entry (service "sports_bet", key "sports_bet", also
  // method "n/a", now a 403 instead of a 404). Left as-is here rather than
  // guessing at a rename -- findEntry below will simply return undefined
  // until this is confirmed and deliberately re-pointed.
  const socketEntry = findEntry(data, "socket", "socket");
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
      buildPayments(raw.data, raw.checkedAt),
      buildCrm(raw.data, raw.checkedAt),
      buildNotifications(raw.data, raw.checkedAt),
      buildCasino(raw.data),
      sportsbook,
      notIntegratedCategory("kyc_risk", "KYC & Risk"),
      notIntegratedCategory("comms", "Comms"),
      buildOther(raw.data, raw.checkedAt),
    ],
  };
}
