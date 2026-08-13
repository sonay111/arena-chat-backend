import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env");
  }
  return key;
}

// Constructed lazily so importing this module doesn't throw before a key
// exists — only the first actual call fails, with a clear message (same
// pattern as src/crm/client.ts). Once ANTHROPIC_API_KEY is added to .env,
// nothing here needs to change.
let cachedClient: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: getApiKey() });
  }
  return cachedClient;
}
