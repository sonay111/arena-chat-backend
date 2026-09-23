import type { StatusValue } from "./types.js";

type DefiniteStatus = "down" | "delayed" | "ok";

// Worst-of-children, but "unknown" is treated as "never checked yet," not
// as a bad outcome to weigh against ok/delayed/down -- it's excluded from
// the comparison entirely unless every single child is unknown, in which
// case the parent is unknown too (there's nothing else to report).
//
// Validated against all 11 real parent/children entries live 2026-09-22
// (8 payment gateways + CRM + OneSignal + In-App Notifications + the
// deposit business flow) with zero mismatches against Satyam's own raw
// parent `status` field -- including rolezpay and crm, which each have
// exactly one genuinely-checked "ok" flow alongside several never-checked
// "unknown" flows and report "ok" at the parent, not "unknown". A naive
// down > delayed > unknown > ok ranking gets those two wrong.
//
// pending_setup (added 2026-09-23) is treated the same way as unknown --
// excluded from the comparison unless it's the only kind of non-definite
// status present. No real pending_setup entry is ever nested inside a
// group today (all 5 are standalone leaves with empty flows: []), so this
// branch is untested against real data -- it's OUR OWN assumption about
// what should happen if that ever changes, not something Satyam's docs
// specify. When every child is unknown/pending_setup with no definitive
// status among them, the parent is "unknown" unless every single child is
// SPECIFICALLY pending_setup (no unknowns at all), in which case the
// parent reports "pending_setup" too -- a more accurate picture than a
// generic "unknown" for a group that's entirely not-yet-integrated.
const SEVERITY: Record<DefiniteStatus, number> = {
  down: 3,
  delayed: 2,
  ok: 1,
};

function isDefinite(status: StatusValue): status is DefiniteStatus {
  return status !== "unknown" && status !== "pending_setup";
}

export function aggregateStatus(childStatuses: StatusValue[]): StatusValue {
  const definitive = childStatuses.filter(isDefinite);
  if (definitive.length > 0) {
    return definitive.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst));
  }
  if (childStatuses.length > 0 && childStatuses.every((s) => s === "pending_setup")) {
    return "pending_setup";
  }
  return "unknown";
}
