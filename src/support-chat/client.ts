import "dotenv/config";
import { SupportChatApiError } from "./errors.js";

export type SupportChatQueryParams = Record<string, string | number | undefined>;

function getBaseUrl(): string {
  const baseUrl = process.env.SUPPORT_CHAT_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("SUPPORT_CHAT_API_BASE_URL is not set in .env");
  }
  return baseUrl;
}

function getApiKey(): string {
  const apiKey = process.env.SUPPORT_CHAT_API_KEY;
  if (!apiKey) {
    throw new Error("SUPPORT_CHAT_API_KEY is not set in .env");
  }
  return apiKey;
}

function getTenantDomain(): string {
  const domain = process.env.SUPPORT_CHAT_TENANT_DOMAIN;
  if (!domain) {
    throw new Error("SUPPORT_CHAT_TENANT_DOMAIN is not set in .env");
  }
  return domain;
}

function buildUrl(path: string, params: SupportChatQueryParams = {}): string {
  const url = new URL(getBaseUrl().replace(/\/$/, "") + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

// Low-level request against the Support Chat API. Every call sends BOTH
// Authorization: Bearer <SUPPORT_CHAT_API_KEY> and x-tenant-domain:
// <SUPPORT_CHAT_TENANT_DOMAIN> — confirmed required on every request, not
// just some. GET (no body) and POST (JSON body) are the only two methods
// the three endpoints in endpoints.ts need.
export async function supportChatRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  options: { params?: SupportChatQueryParams; body?: unknown } = {}
): Promise<T> {
  const url = buildUrl(path, options.params);
  const apiKey = getApiKey();
  const tenantDomain = getTenantDomain();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-tenant-domain": tenantDomain,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    throw new SupportChatApiError(`Support Chat API request failed to send: ${(err as Error).message}`);
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new SupportChatApiError(
      `Support Chat API returned a non-JSON response (HTTP ${response.status})`,
      response.status
    );
  }

  // No documented error-body shape yet (unlike CRM's three known bodies) —
  // treat any non-ok status, or an explicit status: false, as a failure.
  if (!response.ok || json?.status === false) {
    throw new SupportChatApiError(
      json?.message || `Support Chat API request failed (HTTP ${response.status})`,
      response.status
    );
  }

  return json as T;
}
