import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in your .env file (see .env.example).`
    );
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

// "qaId:supportChatId,qaId2:supportChatId2" -> { qaId: supportChatId, ... }.
// Lets a customer the agent knows under one id (e.g. a QA player from the
// withdrawal feed) be reached in the Support Chat widget under a different id
// (their CrazyBet user id). Malformed entries are skipped with a warning.
function parseCustomerIdMap(raw: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of (raw ?? '').split(',')) {
    if (pair.trim() === '') continue;
    const [from, to, ...extra] = pair.split(':').map((part) => part.trim());
    if (!from || !to || extra.length > 0) {
      console.warn(`SUPPORT_CHAT_CUSTOMER_MAP: skipping malformed entry ${JSON.stringify(pair)} (expected "id:id")`);
      continue;
    }
    map[from] = to;
  }
  return map;
}

export const config = {
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceKey: requireEnv('SUPABASE_SERVICE_KEY'),
  // Anthropic is the sole AI brain for all customer messaging (replaced Groq/OpenRouter).
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  withdrawalFeedUrl: requireEnv('WITHDRAWAL_FEED_URL'),

  // TEST_PAYMENT_IDS: if set, the poller only acts on these payment (request) ids and
  // ignores every other withdrawal in the feed. For testing one specific withdrawal.
  testPaymentIds: optionalEnv('TEST_PAYMENT_IDS')
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  // Optional testing/staging helpers.
  // TEST_USER_IDS: if set, the poller only acts on withdrawals whose userId is in this
  // comma-separated list. Leave blank in production so all customers are handled.
  testUserIds: optionalEnv('TEST_USER_IDS')
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  // CBTF widget channel (the Support Chat API). All
  // optional so the service still starts without them: without credentials
  // (or without SUPPORT_CHAT_SEND=true) sendToCustomer only logs what it
  // WOULD send. See channels/supportChat.ts.
  supportChatApiBaseUrl: optionalEnv('SUPPORT_CHAT_API_BASE_URL'),
  supportChatApiKey: optionalEnv('SUPPORT_CHAT_API_KEY'),
  supportChatTenantDomain: optionalEnv('SUPPORT_CHAT_TENANT_DOMAIN'),
  supportChatSendEnabled: optionalEnv('SUPPORT_CHAT_SEND') === 'true',
  customerIdMap: parseCustomerIdMap(optionalEnv('SUPPORT_CHAT_CUSTOMER_MAP')),
  // Opt-in: when exactly "true", ANY customer may be messaged (each withdrawal goes to its own
  // owner's widget) instead of only the ids in TEST_USER_IDS. Support Chat itself refuses a
  // customer that doesn't exist there. Leave off to keep the test-only safety list.
  supportChatAllowAllCustomers: optionalEnv('SUPPORT_CHAT_ALLOW_ALL_CUSTOMERS') === 'true',

  // Secret CrazyBet uses to sign customer-reply webhooks (X-Arena365-Signature) when they are
  // delivered straight to POST /support-chat/webhook. Unset = that route refuses everything.
  supportChatWebhookSecret: optionalEnv('SUPPORT_CHAT_WEBHOOK_SECRET'),

  // Shared secret arena-chat-backend sends (x-cx-agent-secret) when it forwards a
  // customer's widget message to POST /support-chat/inbound. Unset = route refuses everything.
  inboundSecret: optionalEnv('CX_AGENT_INBOUND_SECRET'),

  port: Number(optionalEnv('PORT') ?? '3000'),
  pollIntervalSeconds: Number(optionalEnv('POLL_INTERVAL_SECONDS') ?? '30'),
  // How often the catch-up looks at open customers' chats for unhandled messages. 0 = off.
  catchupIntervalSeconds: (() => {
    const n = Number(optionalEnv('CATCHUP_INTERVAL_SECONDS') ?? '60');
    return Number.isFinite(n) && n >= 0 ? n : 60;
  })(),
} as const;
