// src/feed/serviceHealth.ts
//
// PAYMENT AGENT
// Polls /service-health, extracts each payment gateway's status, flags
// changes and stale (currently delayed/down for too long) checks, and
// sends an alert through the CrazyBet chat widget (via a real automated
// browser session) whenever a targeted gateway (currently: Hero / Crypto)
// is stale. "unknown" (never checked) never counts as stale or triggers a
// message.
//
// BROWSER ALERTS ARE OFF BY DEFAULT: the alert is sent through a real,
// visible browser session on this machine, so it only happens when
// GATEWAY_BROWSER_ALERTS=true is set in .env. Without it, this only logs
// "would have sent". (Added so starting the agent for other tests can't
// open a browser and send live chat messages by surprise.)
//
// DEMO MODE: resends the alert every RESEND_COOLDOWN_SECONDS while the
// gateway stays stale, instead of sending only once, so it's easy to watch
// live during a demo. Set this higher (or back to Infinity-style dedup)
// once this moves past demo/testing. IMPORTANT: keep this value LOWER than
// POLL_INTERVAL_SECONDS in your .env, or timing jitter between the two can
// cause it to silently skip every cycle (see Sept 28 debugging note).

import { sendChatWidgetMessageViaBrowser } from "../channels/chatWidgetBrowser";

const WITHDRAWAL_FEED_URL = process.env.WITHDRAWAL_FEED_URL ?? "";
const SERVICE_HEALTH_URL = new URL("/service-health", WITHDRAWAL_FEED_URL).toString();

const STALE_THRESHOLD_MINUTES = 15;
const STALE_ELIGIBLE_STATUSES = new Set(["delayed", "down"]);

const ALERT_ON_GATEWAY_KEYS = new Set(["hero", "hero_crypto", "crypto"]);

// DEMO: how often to resend the same alert while the gateway stays stale.
const RESEND_COOLDOWN_SECONDS = 20;

type ServiceHealthCheck = {
  key: string;
  label: string;
  kind: "leaf" | "group";
  status: string;
  lastSuccessAt: string | null;
  children?: ServiceHealthCheck[];
};

type ServiceHealthCategory = {
  key: string;
  label: string;
  status: string;
  checks: ServiceHealthCheck[];
};

type ServiceHealthResponse = {
  checkedAt: string | null;
  categories: ServiceHealthCategory[];
};

export type GatewayStatus = {
  key: string;
  label: string;
  status: string;
  checks: ServiceHealthCheck[];
};

async function fetchServiceHealth(): Promise<ServiceHealthResponse | null> {
  try {
    const res = await fetch(SERVICE_HEALTH_URL, {
      headers: { accept: "application/json", "ngrok-skip-browser-warning": "1" },
    });
    if (!res.ok) {
      console.error(`[serviceHealth] /service-health returned ${res.status}`);
      return null;
    }
    return (await res.json()) as ServiceHealthResponse;
  } catch (err) {
    console.error("[serviceHealth] fetch failed:", err);
    return null;
  }
}

function extractGateways(data: ServiceHealthResponse): GatewayStatus[] {
  const payments = data.categories.find((c) => c.key === "payments");
  if (!payments) return [];
  return payments.checks.map((check) => ({
    key: check.key,
    label: check.label,
    status: check.status,
    checks: check.children ?? [],
  }));
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function minutesSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function logSnapshot(gateways: GatewayStatus[]): void {
  for (const gw of gateways) {
    if (gw.checks.length === 0) {
      console.log(`[serviceHealth] ${gw.label}: ${gw.status.toUpperCase()}`);
      continue;
    }
    for (const check of gw.checks) {
      console.log(
        `[serviceHealth] ${gw.label} - ${check.label}: ${check.status.toUpperCase()}, last successful check ${timeAgo(check.lastSuccessAt)}`,
      );
    }
  }
}

export type StaleCheck = {
  gatewayKey: string;
  gatewayLabel: string;
  checkKey: string;
  checkLabel: string;
  status: string;
  lastSuccessAt: string | null;
};

function computeStaleChecks(gateways: GatewayStatus[]): StaleCheck[] {
  const stale: StaleCheck[] = [];
  for (const gw of gateways) {
    for (const check of gw.checks) {
      if (!STALE_ELIGIBLE_STATUSES.has(check.status)) continue;
      if (minutesSince(check.lastSuccessAt) > STALE_THRESHOLD_MINUTES) {
        stale.push({
          gatewayKey: gw.key,
          gatewayLabel: gw.label,
          checkKey: check.key,
          checkLabel: check.label,
          status: check.status,
          lastSuccessAt: check.lastSuccessAt,
        });
      }
    }
  }
  if (stale.length > 0) {
    for (const s of stale) {
      console.log(
        `[serviceHealth] STALE (>${STALE_THRESHOLD_MINUTES}m): ${s.gatewayLabel} - ${s.checkLabel} — status=${s.status.toUpperCase()}, last successful check ${timeAgo(s.lastSuccessAt)}`,
      );
    }
  }
  return stale;
}

// Opt-in switch for the browser-driven alert. Read at call time (not import
// time) so it always reflects the current environment.
export function browserAlertsEnabled(): boolean {
  return process.env.GATEWAY_BROWSER_ALERTS === "true";
}

// With the switch off, say so once per gateway instead of on every poll cycle.
const loggedAlertsOff = new Set<string>();

// Tracks the last time each gateway key was alerted, to enforce the resend
// cooldown (DEMO MODE — see note at top of file).
const lastAlertedAt = new Map<string, number>();

export async function notifyStaleAlertGateways(
  stale: StaleCheck[],
  send: (message: string) => Promise<void> = sendChatWidgetMessageViaBrowser,
  enabled: () => boolean = browserAlertsEnabled
): Promise<void> {
  const alertTargets = stale.filter((s) => ALERT_ON_GATEWAY_KEYS.has(s.gatewayKey));

  if (alertTargets.length === 0) return;

  const byGateway = new Map<string, StaleCheck[]>();
  for (const s of alertTargets) {
    const list = byGateway.get(s.gatewayKey) ?? [];
    list.push(s);
    byGateway.set(s.gatewayKey, list);
  }

  const now = Date.now();

  for (const [gatewayKey, checks] of byGateway) {
    const last = lastAlertedAt.get(gatewayKey);
    const secondsSinceLastAlert = last ? (now - last) / 1000 : Infinity;

    if (secondsSinceLastAlert < RESEND_COOLDOWN_SECONDS) {
      continue; // still within cooldown, skip this cycle
    }

    const label = checks[0].gatewayLabel;
    const message = [
      `⚠️ Payment gateway issue`,
      ``,
      `${label} is currently delayed. Last successful check: ${timeAgo(checks[0].lastSuccessAt)}.`,
      ``,
      `Payments through this method may take longer than usual right now. We're keeping an eye on it.`,
    ].join("\n");

    if (!enabled()) {
      if (!loggedAlertsOff.has(gatewayKey)) {
        loggedAlertsOff.add(gatewayKey);
        console.log(
          `[serviceHealth] ${label} is stale, but browser alerts are OFF (set GATEWAY_BROWSER_ALERTS=true to enable). Nothing sent.`
        );
      }
      continue;
    }

    try {
      await send(message);
      lastAlertedAt.set(gatewayKey, now);
      console.log(`[serviceHealth] Sent stale alert for ${label} via chat widget browser.`);
    } catch (err) {
      console.error(`[serviceHealth] Failed to send chat widget alert for ${label}:`, err);
    }
  }
}

const lastKnownStatus = new Map<string, string>();

export type GatewayStatusChange = {
  key: string;
  label: string;
  from: string;
  to: string;
};

export type ServiceHealthCheckResult = {
  changes: GatewayStatusChange[];
  stale: StaleCheck[];
};

export async function checkGatewayStatusChanges(): Promise<ServiceHealthCheckResult> {
  const data = await fetchServiceHealth();
  if (!data) {
    console.error("[serviceHealth] No data returned, skipping this cycle.");
    return { changes: [], stale: [] };
  }

  const gateways = extractGateways(data);
  const changes: GatewayStatusChange[] = [];

  for (const gw of gateways) {
    const previous = lastKnownStatus.get(gw.key);
    if (previous !== undefined && previous !== gw.status) {
      changes.push({ key: gw.key, label: gw.label, from: previous, to: gw.status });
    }
    lastKnownStatus.set(gw.key, gw.status);
  }

  logSnapshot(gateways);
  const stale = computeStaleChecks(gateways);

  if (changes.length > 0) {
    for (const c of changes) {
      console.log(
        `[serviceHealth] CHANGE DETECTED: ${c.label} (${c.key}) went from "${c.from}" to "${c.to}"`,
      );
    }
  }

  await notifyStaleAlertGateways(stale);

  return { changes, stale };
}