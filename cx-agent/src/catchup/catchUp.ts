import type { ConversationState } from '../types';
import { getOpenConversations, hasSupportChatMessage } from '../db/conversations';
import {
  canMessageCustomer,
  fetchRecentCustomerMessages,
  toSupportChatUserId,
  type SupportChatCustomerMessage,
} from '../channels/supportChat';
import { handleCustomerMessage, type InboundCustomerMessage } from '../inbound/handleCustomerMessage';
import { config } from '../config';

// Catch-up: the backend's forwarder is the fast path for a customer's reply, but it does not retry,
// so a reply sent while the agent or the backend was down is lost. This looks at the customer's own
// chat in Support Chat every so often and answers any customer message the agent has not handled.
// It only ever looks at customers the agent has an open conversation with.

const MAX_AGE_HOURS = 24;
const MAX_PER_CUSTOMER_PER_RUN = 3;

/**
 * Which of a customer's messages may need an answer: written after the conversation started
 * (earlier chat is not about this withdrawal), recent enough, and oldest first.
 */
export function selectCandidateMessages(
  messages: SupportChatCustomerMessage[],
  conversationStart: Date,
  now: Date,
  maxAgeHours: number = MAX_AGE_HOURS
): SupportChatCustomerMessage[] {
  const oldestAllowed = now.getTime() - maxAgeHours * 3600_000;
  return messages
    .filter((m) => {
      const at = new Date(m.createdAt).getTime();
      return Number.isFinite(at) && at > conversationStart.getTime() && at >= oldestAllowed;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export type CatchUpDeps = {
  listOpenConversations: () => Promise<ConversationState[]>;
  fetchCustomerMessages: (supportChatUserId: string) => Promise<SupportChatCustomerMessage[]>;
  alreadyHandled: (messageId: string) => Promise<boolean>;
  handle: (message: InboundCustomerMessage) => Promise<void>;
  canMessage: (customerId: string) => boolean;
  toSupportChatId: (customerId: string) => string;
};

export const defaultCatchUpDeps: CatchUpDeps = {
  listOpenConversations: getOpenConversations,
  fetchCustomerMessages: (id) => fetchRecentCustomerMessages(id),
  alreadyHandled: hasSupportChatMessage,
  handle: handleCustomerMessage,
  canMessage: canMessageCustomer,
  toSupportChatId: toSupportChatUserId,
};

/** One pass. Returns how many customer messages it answered. */
export async function runCatchUp(deps: CatchUpDeps = defaultCatchUpDeps, now: Date = new Date()): Promise<number> {
  const open = await deps.listOpenConversations();

  // One look per customer, from the earliest start among their open conversations.
  const startByCustomer = new Map<string, Date>();
  for (const c of open) {
    if (!c.first_seen_at || !deps.canMessage(c.customer_id)) continue;
    const start = new Date(c.first_seen_at);
    const known = startByCustomer.get(c.customer_id);
    if (!known || start < known) startByCustomer.set(c.customer_id, start);
  }

  let answered = 0;
  for (const [customerId, start] of startByCustomer) {
    try {
      const supportChatId = deps.toSupportChatId(customerId);
      const messages = await deps.fetchCustomerMessages(supportChatId);
      const candidates = selectCandidateMessages(messages, start, now);

      let handledThisRun = 0;
      for (const m of candidates) {
        if (handledThisRun >= MAX_PER_CUSTOMER_PER_RUN) break;
        if (await deps.alreadyHandled(m.id)) continue;
        console.warn(`catch-up: answering a customer message the agent had not handled (${m.id})`);
        await deps.handle({ customerId: supportChatId, text: m.body, messageId: m.id });
        handledThisRun++;
        answered++;
      }
    } catch (err) {
      console.error(`catch-up: could not check customer …${customerId.slice(-6)}`, err);
    }
  }
  return answered;
}

let running = false;

/** Starts the catch-up on its own timer, independent of the withdrawal poll and of the backend. */
export function startCatchUp(): void {
  const seconds = config.catchupIntervalSeconds;
  if (!seconds) {
    console.log('catch-up is disabled (CATCHUP_INTERVAL_SECONDS=0)');
    return;
  }
  console.log(`catch-up: checking customers' chats every ${seconds}s for messages the agent has not handled`);
  setInterval(async () => {
    if (running) return; // never overlap two passes
    running = true;
    try {
      await runCatchUp();
    } catch (err) {
      console.error('catch-up failed', err);
    } finally {
      running = false;
    }
  }, seconds * 1000);
}
