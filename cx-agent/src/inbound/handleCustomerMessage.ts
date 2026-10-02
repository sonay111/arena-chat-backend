import {
  getAllConversationsByCustomerId,
  hasSupportChatMessage,
  countOpenConversationsForCustomer,
  insertHistory,
  updateConversation,
  getHistoryForConversation,
  getScenarioContext,
} from '../db/conversations';
import { draftAgentMessage, WithdrawalStatus } from '../ai/drafts';
import { nextCheckInMinutes } from '../orchestrator/checkinPolicy';
import { detectAndTranslateToEnglish, translateFromEnglish, SupportedLanguage } from '../ai/translate';
import {
  multipleOpenWithdrawalsClarification,
  askForReferenceIdClarification,
  noRecordFoundNote,
} from '../messages/templates';
import { canMessageCustomer, sendToCustomer, toCustomerId } from '../channels/supportChat';
import { ConversationState } from '../types';
import { messageGuard } from './inFlight';

// A customer wrote in the CBTF widget: work out which withdrawal they mean,
// translate + store their message, draft a reply with the AI agent, send it,
// record it. Notes:
//   - the customer is found by customer_id (their userId);
//   - there is no "a human owns this conversation" gate — this agent answers
//     every conversation itself.

const RESOLUTION_STATUS_MAP: Record<string, WithdrawalStatus> = {
  completed: 'COMPLETED',
  rejected: 'REJECTED',
  failed: 'FAILED',
};

export type InboundCustomerMessage = {
  customerId: string;
  text: string;
  // Support Chat's messageId, when the message came straight from its webhook. Lets us
  // ignore a re-delivery of the same message and records it with the stored reply.
  messageId?: string;
};

function findByReference(all: ConversationState[], text: string): ConversationState | null {
  const lower = text.toLowerCase();
  const matches = all.filter(
    (c) => lower.includes(c.payment_id.toLowerCase()) || lower.includes(c.payment_id.slice(-8).toLowerCase())
  );
  return matches.length === 1 ? matches[0] : null;
}

function findByAmount(open: ConversationState[], text: string): ConversationState | null {
  const lower = text.toLowerCase();
  const matches = open.filter((c) => c.amount != null && lower.includes(String(c.amount)));
  return matches.length === 1 ? matches[0] : null;
}

// Says something to the customer AND records it, so history always matches
// what they actually saw. Localized for the customer; history stays English.
async function say(
  convo: ConversationState,
  role: 'agent' | 'system',
  englishText: string,
  metadata: Record<string, unknown> | null = null
): Promise<void> {
  const language = (convo.customer_language ?? 'en') as SupportedLanguage;
  const localized = await translateFromEnglish(englishText, language);
  await sendToCustomer(convo.customer_id, localized);
  const at = new Date().toISOString();
  await insertHistory({
    conversation_id: convo.conversation_id,
    customer_id: convo.customer_id,
    role,
    message: englishText,
    sent_at: at,
    metadata: language !== 'en' ? { ...metadata, localized_text: localized, sent_language: language } : metadata,
  });
  await updateConversation(convo.conversation_id, { agent_last_message_at: at });
}

// Which conversation does this message belong to? Returns null when the
// answer is "can't tell" — in which case a clarifying question has already
// been sent, and the caller stops.
async function resolveConversation(
  customerId: string,
  text: string
): Promise<ConversationState | null> {
  const all = await getAllConversationsByCustomerId(customerId);

  if (all.length === 0) {
    // No conversation ever, so there's nowhere to record a reply either.
    console.warn(`inbound: customer ${customerId} has no conversations — nothing to attach a reply to`);
    await sendToCustomer(customerId, noRecordFoundNote());
    return null;
  }

  const byReference = findByReference(all, text);
  if (byReference) return byReference;

  const open = all.filter((c) => c.status !== 'resolved');
  if (open.length === 1) return open[0];

  if (open.length > 1) {
    const byAmount = findByAmount(open, text);
    if (byAmount) return byAmount;
    await say(
      open[0],
      'system',
      multipleOpenWithdrawalsClarification(
        open.map((c) => ({ amount: c.amount, currency: c.currency, payment_id: c.payment_id }))
      ),
      { reason: 'multiple_open_withdrawals_clarification' }
    );
    return null;
  }

  // Nothing open: a single past conversation is obviously the one; several
  // means we have to ask.
  if (all.length === 1) return all[0];
  await say(all[0], 'system', askForReferenceIdClarification(), { reason: 'multiple_past_conversations_no_reference' });
  return null;
}

async function processCustomerMessage({ customerId: supportChatUserId, text, messageId }: InboundCustomerMessage): Promise<void> {
  // The webhook carries the Support Chat (CrazyBet) user id; conversations are
  // stored under the agent's own id. Same id unless SUPPORT_CHAT_CUSTOMER_MAP maps them.
  const customerId = toCustomerId(supportChatUserId);

  if (!canMessageCustomer(customerId)) {
    // Not a listed test customer: don't spend AI calls or write anything.
    console.warn(`inbound: ignoring message from ${customerId} — not in TEST_USER_IDS`);
    return;
  }

  if (messageId && (await hasSupportChatMessage(messageId))) {
    console.log(`inbound: message ${messageId} was already handled — ignoring the repeat`);
    return;
  }

  const convo = await resolveConversation(customerId, text);
  if (!convo) return;

  // Detect language and translate to English first: the agent prompt only
  // ever reasons over English, and the original is kept for audit.
  const translation = await detectAndTranslateToEnglish(text);
  if (translation.detectedLanguage !== convo.customer_language) {
    await updateConversation(convo.conversation_id, { customer_language: translation.detectedLanguage });
    convo.customer_language = translation.detectedLanguage;
  }

  const now = new Date().toISOString();
  await insertHistory({
    conversation_id: convo.conversation_id,
    customer_id: convo.customer_id,
    role: 'customer',
    message: translation.englishText,
    sent_at: now,
    metadata: {
      original_text: text,
      detected_language: translation.detectedLanguage,
      ...(messageId ? { support_chat_message_id: messageId } : {}),
    },
  });
  await updateConversation(convo.conversation_id, { last_webhook_flag_at: now });

  const [fullHistory, scenario, openCount] = await Promise.all([
    getHistoryForConversation(convo.conversation_id),
    getScenarioContext(convo.conversation_id),
    countOpenConversationsForCustomer(convo.customer_id),
  ]);
  const history = fullHistory.slice(-6);

  const currentStatus: WithdrawalStatus =
    convo.resolution_outcome && RESOLUTION_STATUS_MAP[convo.resolution_outcome]
      ? RESOLUTION_STATUS_MAP[convo.resolution_outcome]
      : 'PENDING';

  const output = await draftAgentMessage({
    withdrawal_id: convo.payment_id,
    amount: convo.amount,
    currency: convo.currency,
    current_status: currentStatus,
    verified_customer_reason: convo.resolution_reason ?? convo.reason,
    reason_is_customer_safe: convo.reason_is_customer_safe ?? false,
    next_step_instructions: null,
    verified_timeframe: scenario?.eta_text ?? null,
    trigger_type: 'USER_REPLY',
    next_check_in_minutes: currentStatus === 'PENDING' ? nextCheckInMinutes(convo.checkin_count) : null,
    pending_update_count: convo.pending_update_count,
    has_multiple_open_withdrawals: openCount > 1,
    message_history: history.map((h) => ({ role: h.role, message: h.message })),
  });

  if (output.send) {
    await say(convo, 'agent', output.message);
  }

  if (output.escalate) {
    // Recorded as a flag only. It never silences the agent and no human
    // takes over — the flag is just a visible note for whoever reads the
    // conversation afterwards.
    await updateConversation(convo.conversation_id, {
      escalation_flagged: true,
      escalation_reason: output.escalation_reason,
    });
  }
}

export async function handleCustomerMessage(message: InboundCustomerMessage): Promise<void> {
  const id = message.messageId;
  if (id && !messageGuard.tryAcquire(id)) {
    console.log(`inbound: message ${id} is already being handled — ignoring the duplicate`);
    return;
  }
  try {
    await processCustomerMessage(message);
  } finally {
    if (id) messageGuard.release(id);
  }
}
