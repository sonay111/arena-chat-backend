import "dotenv/config";
import type { RawServiceHealthResponse } from "./types.js";

// Deliberately NOT going through crmGet (src/crm/client.ts) -- confirmed
// live 2026-09-22 that this endpoint requires no auth at all, unlike every
// other CRM endpoint (no x-crm-token header sent, still a clean HTTP 200).
// Same host as every other CRM call, so CRM_API_BASE_URL is still the
// right source of truth for it, just without the token.
export async function fetchRawServiceHealth(): Promise<RawServiceHealthResponse> {
  const baseUrl = process.env.CRM_API_BASE_URL;
  if (!baseUrl) throw new Error("CRM_API_BASE_URL is not set in .env");

  const url = baseUrl.replace(/\/$/, "") + "/service-health";

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`GET /service-health request failed to send: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`GET /service-health failed with HTTP ${response.status}`);
  }

  return (await response.json()) as RawServiceHealthResponse;
}
