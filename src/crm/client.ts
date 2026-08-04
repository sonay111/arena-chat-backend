import "dotenv/config";
import { CrmApiError, mapCrmError } from "./errors.js";

export type CrmQueryParams = Record<string, string | number | undefined>;

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
export async function crmGet<T = unknown>(path: string, params: CrmQueryParams = {}): Promise<T> {
  const url = buildUrl(path, params);
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-crm-token": token,
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
