// pending_setup added 2026-09-23, alongside the 40-entry expansion: a
// "known, intentionally not integrated yet" check (SportRadar Back
// Office, KYC/Shifty Pro, Calling System, Content Creator System,
// SportRadar Live Tracker) -- distinct from unknown ("should be checked,
// but nothing came back yet"). All 5 real examples today are standalone
// leaves with empty flows: [], never nested inside a group.
export type StatusValue = "ok" | "delayed" | "down" | "unknown" | "pending_setup";
export type CategoryStatus = StatusValue | "not_integrated";
export type RealCoverage = "full" | "partial" | "none";

// Shape confirmed live 2026-09-22 against GET {CRM_API_BASE_URL}/service-health
// (alias /v1/health/services) -- unlike every other CRM endpoint, this one
// requires no auth token at all (see fetch-raw.ts).
export type RawCheck = {
  key: string;
  label: string;
  method: string;
  status: StatusValue;
  lastEventStatus?: StatusValue;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAgeMs?: number | null;
  expectedIntervalMs?: number | null;
  slowMs?: number | null;
  lastError: string | null;
  lastErrors?: Array<{ message: string; at: string }>;
  responseTimeMs: number | null;
  // Added 2026-09-23 on the 5 real pending_setup entries, explaining why
  // each isn't integrated yet (e.g. "Frontend-embedded third-party widget
  // ... no backend call in these services to monitor"). This is Satyam's
  // own explanatory text from the source -- kept completely separate from
  // NormalizedLeaf/NormalizedGroup's own `note` (our own annotations, e.g.
  // the socket entry's investigation finding) via the `sourceNote` field;
  // never merge the two.
  note?: string;
};

// A top-level data[] entry is either "simple" (has its own status/method
// directly, e.g. st8_casino_callbacks) or a parent with flows[] (payment
// gateways, CRM, notifications) or steps[] (the deposit business flow) --
// never both. `category` is the field to group by, NOT `service`.
//
// `key` alone is NOT a unique identity in this API -- confirmed live
// 2026-09-23: "sportsradar_producer_connection" exists twice, once under
// service "socket" and once under service "odds_streamer" (identical
// data, genuinely the same underlying check surfaced into two service
// groupings); "frogo_risk_signal" also exists twice, under service
// "payment" and service "socket", this time with two DIFFERENT labels
// ("Frogo Risk Scoring" vs "Frogo Risk Scoring (Bet Settlement)") -- two
// distinct real checks that happen to share a key. Every lookup in this
// module is service+key together (see normalize.ts's findEntry) -- never
// key alone.
export type RawEntry = RawCheck & {
  service: string;
  category: string;
  countries?: string[];
  flows?: RawCheck[];
  steps?: RawCheck[];
};

export type RawServiceHealthResponse = {
  status: boolean;
  checkedAt: string;
  summary: {
    total: number;
    worst: StatusValue;
    ok: number;
    delayed: number;
    down: number;
    unknown: number;
    pending_setup?: number;
  };
  data: RawEntry[];
};

// Our own normalized shape -- recursive so a payment gateway (a group of
// flows) nests the same way an Other business-flow chain (a group of
// steps) does, and a single check (Casino) needs no group wrapper at all.
export type NormalizedLeaf = {
  kind: "leaf";
  key: string;
  label: string;
  method: string;
  status: StatusValue;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  responseTimeMs: number | null;
  // Only set on the handful of checks we're deliberately annotating for a
  // human reading the response (e.g. the socket entry's investigation
  // finding) -- absent everywhere else. OUR OWN annotation.
  note?: string;
  // Satyam's own explanatory text from the raw entry's `note` field (see
  // RawCheck.note) -- passed through verbatim, kept distinct from `note`
  // above. Never merged into one field: `note` is us explaining something
  // to a reader of this response; `sourceNote` is the source explaining
  // itself.
  sourceNote?: string;
};

export type NormalizedGroup = {
  kind: "group";
  key: string;
  label: string;
  status: StatusValue;
  // Derived from children, not passed through from any single raw field --
  // the raw parent entry itself carries none of these (confirmed live
  // 2026-09-22: a flows[]/steps[] parent's own lastSuccessAt/lastFailureAt
  // are always null in the real response). Most-recent-wins across every
  // descendant leaf (recursing through nested groups, though none exist
  // in real data today).
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  // Deliberately always null -- averaging response time across flows that
  // check different things isn't meaningful. Expand to see each flow's own
  // responseTimeMs instead.
  responseTimeMs: null;
  // Only set when status is delayed/down: names the single child (the
  // first one, in original order, at the same severity as the group's own
  // worst-of-children status) actually responsible, plus how long it's
  // been since that child last succeeded. Null when status is ok/unknown
  // -- there's no single "issue" to point at.
  issueDetail: string | null;
  children: NormalizedNode[];
  // Same distinction as NormalizedLeaf: `note` is our own annotation,
  // `sourceNote` is Satyam's raw text from the parent entry itself (not
  // observed on a real flows[]/steps[] parent yet -- all 5 real
  // pending_setup notes today are on standalone leaves -- but the raw
  // type allows it, so this is threaded through defensively).
  note?: string;
  sourceNote?: string;
};

export type NormalizedNode = NormalizedLeaf | NormalizedGroup;

export type NormalizedCategory = {
  key: string;
  label: string;
  status: CategoryStatus;
  realCoverage: RealCoverage;
  note?: string;
  checks: NormalizedNode[];
};

export type NormalizedServiceHealth = {
  checkedAt: string;
  categories: NormalizedCategory[];
};
