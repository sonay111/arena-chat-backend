import { ConversationState, ConversationRole } from '../types';
import { insertHistory, getHistoryForConversation } from '../db/conversations';
import { sendToCustomer as sendSupportChatMessage, canMessageCustomer } from '../channels/supportChat';
import { HistoryMessage } from '../ai/drafts';
import { translateFromEnglish, SupportedLanguage } from '../ai/translate';

// Helpers every specialist uses to talk to a customer and keep the record straight.

const HISTORY_WINDOW = 6;

export async function getRecentHistory(conversationId: string): Promise<HistoryMessage[]> {
  const fullHistory = await getHistoryForConversation(conversationId);
  return fullHistory
    .slice(-HISTORY_WINDOW)
    .map((h) => ({ role: h.role, message: h.message }));
}

export async function logAndMaybeSend(params: {
  conversation: ConversationState;
  role: ConversationRole;
  message: string;
  sendToCustomer: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { conversation, role, message, sendToCustomer, metadata } = params;

  if (sendToCustomer) {
    if (canMessageCustomer(conversation.customer_id)) {
      const targetLanguage = (conversation.customer_language ?? 'en') as SupportedLanguage;
      const localizedMessage = await translateFromEnglish(message, targetLanguage);
      await sendSupportChatMessage(conversation.customer_id, localizedMessage);
    }
  }

  await insertHistory({
    conversation_id: conversation.conversation_id,
    customer_id: conversation.customer_id,
    role,
    message,
    sent_at: new Date().toISOString(),
    metadata: metadata ?? null,
  });
}
