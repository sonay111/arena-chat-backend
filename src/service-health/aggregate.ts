import type { StatusValue } from "./types.js";

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
const SEVERITY: Record<Exclude<StatusValue, "unknown">, number> = {
  down: 3,
  delayed: 2,
  ok: 1,
};

export function aggregateStatus(childStatuses: StatusValue[]): StatusValue {
  const definitive = childStatuses.filter((s): s is Exclude<StatusValue, "unknown"> => s !== "unknown");
  if (definitive.length === 0) return "unknown";
  return definitive.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst));
}
