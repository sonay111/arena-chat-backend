import { supportChatRequest } from "./client.js";

// Response shapes are NOT confirmed with a real call yet (this API is
// brand new, 2026-09-29) — kept loose/defensive on purpose rather than
// guessing a precise shape, same "don't assume, verify against real
// traffic" approach every CRM endpoint in this project followed before
// its real shape was confirmed. Update these once a real response is seen
// (see the live sendMessage call this module was built alongside).
export type SupportChatMessage = Record<string, unknown>;
export type SupportChatConversation = Record<string, unknown>;

export type SendMessageOptions = {
  // The message text. Confirmed field name is "body" — note this is the
  // message text specifically, distinct from client.ts's own `body` param
  // (the whole options object here becomes that request body verbatim).
  body: string;
  paymentRef?: string;
  userId?: string;
  conversationId?: string;
  clientMessageId?: string;
};

// paymentRef (the Pay777 order id) is enough on its own for the API to
// resolve the right conversation — no userId lookup needed when it's
// known. userId/conversationId are the alternative ways to target a send
// when there's no paymentRef. Not enforced as a type-level union since the
// API itself validates and rejects an under-specified call.
export async function sendMessage(options: SendMessageOptions): Promise<SupportChatMessage> {
  return supportChatRequest<SupportChatMessage>("POST", "/messages", { body: options });
}

// Handles either a bare array or a { messages: [...] } envelope — whichever
// the real API turns out to use. Narrow this once confirmed.
export async function getConversationMessages(
  conversationId: string,
  limit?: number,
  before?: string
): Promise<SupportChatMessage[]> {
  const result = await supportChatRequest<{ messages?: SupportChatMessage[] } | SupportChatMessage[]>(
    "GET",
    `/conversations/${conversationId}/messages`,
    { params: { limit, before } }
  );
  return Array.isArray(result) ? result : (result.messages ?? []);
}

export async function getUserConversations(userId: string): Promise<SupportChatConversation[]> {
  const result = await supportChatRequest<{ conversations?: SupportChatConversation[] } | SupportChatConversation[]>(
    "GET",
    `/users/${userId}/conversations`
  );
  return Array.isArray(result) ? result : (result.conversations ?? []);
}
