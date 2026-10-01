import "dotenv/config";
import { CrmApiError, mapCrmError } from "./errors.js";

export type CrmQueryParams = Record<string, string | number | undefined>;

// Confirmed by Satyam (2026-10-01): the CRM API is now shared across
// brands on one base URL/token, and requires x-tenant-domain on every
// request to say which brand a call is for. Values confirmed directly —
// not guessed.
export type CrmBrand = "arena365" | "crazybet";

const TENANT_DOMAINS: Record<CrmBrand, string> = {
  arena365: "arena365.com",
  crazybet: "crazybet.vgb2b.com",
};

function getBaseUrl(): string {
  const baseUrl = process.env.CRM_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("CRM_API_BASE_URL is not set in .env");
  }
  return baseUrl;
}

function getToken(): string {
  const token = process.env.CRM_API_TOKEN;
  if (!token) {
    throw new Error("CRM_API_TOKEN is not set in .env");
  }
  return token;
}

function buildUrl(path: string, params: CrmQueryParams): string {
  // Base URL and token come from .env, never hardcoded — staging and
  // production have different values (see .env.example).
  const url = new URL(getBaseUrl().replace(/\/$/, "") + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

// Low-level GET against the CRM API. Every endpoint function in
// endpoints.ts goes through this — it's the one place that knows about
// auth, base URL, and how to turn the doc's three documented error bodies
// into distinguishable exceptions.
//
// brand is required, not optional/defaulted — there is no safe default
// brand to silently fall back to now that the CRM is shared across
// Arena365 and CrazyBet; every caller must say which one it means.
export async function crmGet<T = unknown>(
  path: string,
  brand: CrmBrand,
  params: CrmQueryParams = {}
): Promise<T> {
  const url = buildUrl(path, params);
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-crm-token": token,
        "x-tenant-domain": TENANT_DOMAINS[brand],
      },
    });
  } catch (err) {
    throw new CrmApiError(`CRM API request failed to send: ${(err as Error).message}`);
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new CrmApiError(`CRM API returned a non-JSON response (HTTP ${response.status})`, response.status);
  }

  if (!response.ok || json?.status === false) {
    throw mapCrmError(json, response.status);
  }

  return json as T;
}
