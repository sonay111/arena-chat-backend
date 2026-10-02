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

export type SupportChatCustomerMessage = { id: string; body: string; createdAt: string };

async function supportChatGet(path: string): Promise<any> {
  const { supportChatApiBaseUrl: base, supportChatApiKey: key, supportChatTenantDomain: tenant } = config;
  if (!base || !key || !tenant) {
    throw new Error('SUPPORT_CHAT_API_BASE_URL / SUPPORT_CHAT_API_KEY / SUPPORT_CHAT_TENANT_DOMAIN are not all set.');
  }
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${key}`, 'x-tenant-domain': tenant },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Support Chat GET ${path.split('?')[0]} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * The customer's own most recent messages from their open Support Chat conversation (read only).
 * Used to catch customer messages that never reached the agent, for example because the
 * backend's forwarder was down. Returns [] when the customer has no open conversation.
 */
export async function fetchRecentCustomerMessages(supportChatUserId: string, limit = 10): Promise<SupportChatCustomerMessage[]> {
  const conversations = await supportChatGet(`/users/${encodeURIComponent(supportChatUserId)}/conversations`);
  const liveId: string | undefined = conversations?.data?.liveConversationId;
  if (!liveId) return [];

  const thread = await supportChatGet(`/conversations/${encodeURIComponent(liveId)}/messages?limit=${limit}`);
  const messages: any[] = thread?.data?.messages ?? [];
  return messages
    .filter((m) => m?.sender === 'customer' && typeof m.id === 'string' && typeof m.body === 'string' && m.body.trim() !== '')
    .map((m) => ({ id: m.id as string, body: m.body as string, createdAt: m.createdAt as string }));
}

export type SupportChatConversationInfo = {
  status?: string;
  endedAt?: string | null;
  endedBy?: string | null;
};

/**
 * Did the customer end their most recent chat on or after `since`? The API lists conversations
 * newest first. Ending a chat is a clear signal that the customer does not want to be interrupted,
 * so the agent stops its reminders (the outcome message and replies to the customer still go out).
 */
export function customerEndedChat(conversationsNewestFirst: SupportChatConversationInfo[], since: Date): boolean {
  const newest = conversationsNewestFirst[0];
  if (!newest) return false;
  return (
    newest.status === 'closed' &&
    newest.endedBy === 'customer' &&
    !!newest.endedAt &&
    new Date(newest.endedAt).getTime() >= since.getTime()
  );
}

/** Reads the customer's conversations from Support Chat and applies customerEndedChat (read only). */
export async function hasCustomerEndedChatSince(supportChatUserId: string, since: Date): Promise<boolean> {
  const result = await supportChatGet(`/users/${encodeURIComponent(supportChatUserId)}/conversations`);
  return customerEndedChat(result?.data?.conversations ?? [], since);
}
