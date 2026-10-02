import { randomUUID } from 'node:crypto';
import { config } from '../config';

// The customer channel: the CBTF widget, via the Support Chat API. Every outbound
// message reaches a customer through here. The customer is addressed by their
// userId (customer_id) — there is no chat id to link.

/**
 * Who may be messaged. By default only customers listed in TEST_USER_IDS (the widget reaches real
 * customers, so the list has to be explicit). With SUPPORT_CHAT_ALLOW_ALL_CUSTOMERS=true any
 * customer may be messaged, so each withdrawal goes to its own owner. The allowlist is always
 * checked on the agent's own id, never a mapped one.
 */
export function canMessageCustomer(customerId: string): boolean {
  return config.supportChatAllowAllCustomers || Boolean(config.testUserIds?.includes(customerId));
}

/**
 * The agent knows a customer by one id (from the withdrawal feed); the
 * Support Chat API knows them by their CrazyBet user id. These are the same
 * id unless SUPPORT_CHAT_CUSTOMER_MAP says otherwise. The allowlist above is
 * always checked on the agent's own id, never the mapped one.
 */
export function toSupportChatUserId(customerId: string): string {
  return config.customerIdMap[customerId] ?? customerId;
}

/** The reverse: a Support Chat userId (from a webhook) back to the agent's own id. */
export function toCustomerId(supportChatUserId: string): string {
  for (const [customerId, mapped] of Object.entries(config.customerIdMap)) {
    if (mapped === supportChatUserId) return customerId;
  }
  return supportChatUserId;
}

/**
 * Sends one message into the customer's CBTF chat. Returns true if a real
 * send happened, false if skipped (customer not allowed, or not found in Support Chat) or dry run.
 *
 * Dry run (the default) logs what would be sent and sends nothing — it
 * needs SUPPORT_CHAT_SEND=true AND all three credentials to go live.
 */
export async function sendToCustomer(
  customerId: string,
  text: string,
  // Sent as clientMessageId: the API returns the original message instead of
  // posting a second one when a retry reuses the same value (max 128 chars).
  // A caller that retries a send must pass the SAME id each time; the random
  // default only guarantees every message has a unique one.
  clientMessageId: string = randomUUID()
): Promise<boolean> {
  if (!canMessageCustomer(customerId)) {
    console.warn(`support-chat: skipping ${customerId} — not in TEST_USER_IDS`);
    return false;
  }

  if (!config.supportChatSendEnabled) {
    const target = toSupportChatUserId(customerId);
    console.log(`support-chat DRY RUN → ${customerId}${target !== customerId ? ` (as ${target})` : ''}: ${JSON.stringify(text)}`);
    return false;
  }

  const { supportChatApiBaseUrl: base, supportChatApiKey: key, supportChatTenantDomain: tenant } = config;
  if (!base || !key || !tenant) {
    throw new Error(
      'SUPPORT_CHAT_SEND is on but SUPPORT_CHAT_API_BASE_URL / SUPPORT_CHAT_API_KEY / SUPPORT_CHAT_TENANT_DOMAIN are not all set.'
    );
  }

  const res = await fetch(`${base.replace(/\/$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'x-tenant-domain': tenant,
    },
    body: JSON.stringify({ body: text, userId: toSupportChatUserId(customerId), clientMessageId }),
  });

  // 404 = this customer doesn't exist in Support Chat (for example a player from another
  // platform). Nothing can be delivered, but it is not an error worth stopping the agent for.
  if (res.status === 404) {
    console.warn(`support-chat: ${customerId} (as ${toSupportChatUserId(customerId)}) not found in Support Chat — nothing delivered`);
    return false;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Support Chat sendMessage failed: ${res.status} ${res.statusText} ${detail}`);
  }
  return true;
}
