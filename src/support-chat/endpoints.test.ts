import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGetConversationMessagesResponse } from "./endpoints.js";

// No mocking library exists in this project — parseGetConversationMessagesResponse
// is a pure function specifically so this can test the real envelope shape
// directly, same rationale as parseGetUsersResponse in src/crm/endpoints.test.ts.

// Exact shape confirmed live 2026-10-01, the first real GET against an
// actual conversation (conversationId 6abb8ff6802c46f12773301f) — this is
// what exposed the original guessed shape ({messages: [...]} at the top
// level, or a bare array) as wrong. Messages sit at data.messages.
const REAL_RESPONSE = {
  message: "Messages fetched",
  data: {
    conversation: {
      conversationId: "6abb8ff6802c46f12773301f",
      userId: "6ab65b0acc19716479b313ef",
      status: "active",
      agentName: "Crazy Bet Support",
      startedAt: "2026-09-29T10:16:22.658Z",
      endedAt: null,
      endedBy: null,
      lastMessageAt: "2026-09-30T09:07:08.741Z",
      lastMessageSender: "operator",
      unreadForCustomer: 0,
    },
    messages: [
      {
        id: "6abcd13ce30a70e047dd3ee0",
        conversationId: "6abb8ff6802c46f12773301f",
        userId: "6ab65b0acc19716479b313ef",
        sender: "operator",
        body: "Test message from the new support agent (Palig is testing the connection). Please ignore this message.",
        createdAt: "2026-09-30T09:07:08.741Z",
        via: "api",
      },
      {
        id: "6abbae2f9acf14dc5faa7416",
        conversationId: "6abb8ff6802c46f12773301f",
        userId: "6ab65b0acc19716479b313ef",
        sender: "customer",
        body: "i want to test this",
        createdAt: "2026-09-29T12:25:19.696Z",
        via: "customer",
      },
    ],
    nextBefore: null,
  },
  status: true,
};

test("parseGetConversationMessagesResponse reads messages from data.messages, not a top-level key", () => {
  const result = parseGetConversationMessagesResponse(REAL_RESPONSE);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "6abcd13ce30a70e047dd3ee0");
  assert.equal(result[0].sender, "operator");
  assert.equal(result[1].sender, "customer");
});

test("parseGetConversationMessagesResponse does not accidentally pick up data.conversation or data.nextBefore", () => {
  const result = parseGetConversationMessagesResponse(REAL_RESPONSE);
  assert.ok(Array.isArray(result));
  assert.equal((result as unknown as Record<string, unknown>).conversation, undefined);
});
