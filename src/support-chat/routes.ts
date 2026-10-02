import express, { Router } from "express";
import type { Request, Response } from "express";
import { verifySupportChatWebhookSignature, parseSupportChatWebhookBody } from "./webhook.js";
import type { SupportChatWebhookEvent } from "./webhook.js";
import { claimMessageId as claimMessageIdDefault } from "./idempotency.js";
import { getConversationMessages as getConversationMessagesDefault, sendMessage as sendMessageDefault } from "./endpoints.js";
import type { SupportChatMessage, SendMessageOptions } from "./endpoints.js";
import { SupportChatApiError } from "./errors.js";
import { forwardToCxAgent as forwardToCxAgentDefault } from "./cx-agent-forward.js";

// handleCustomerMessageReceived, claimMessageId, fetchConversationMessages,
// sendSupportChatMessage, and forwardToCxAgent are all injectable so tests
// can stub them out without needing a real downstream consumer, a real
// database, or a live call to the external Support Chat API / cx-agent —
// same DI convention as every other router in this project.
export function createSupportChatRouter(
  handleCustomerMessageReceived: (event: SupportChatWebhookEvent) => Promise<void> | void = async () => {},
  claimMessageId: (messageId: string) => Promise<boolean> = claimMessageIdDefault,
  fetchConversationMessages: (
    conversationId: string,
    limit?: number,
    before?: string
  ) => Promise<SupportChatMessage[]> = getConversationMessagesDefault,
  sendSupportChatMessage: (options: SendMessageOptions) => Promise<SupportChatMessage> = sendMessageDefault,
  forwardToCxAgent: (event: SupportChatWebhookEvent) => Promise<void> | void = forwardToCxAgentDefault
): Router {
  const router = Router();

  // express.raw() (not express.json()) scoped to just this one route —
  // HMAC verification needs the exact original bytes, not a re-serialized
  // object, same reasoning as src/webhooks/envelope.ts's rawBodyParser.
  // type: () => true accepts any Content-Type, since we don't control what
  // the Support Chat platform actually sends.
  router.post(
    "/support-chat/webhook",
    express.raw({ type: () => true }),
    verifySupportChatWebhookSignature,
    async (req: Request, res: Response) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const event = parseSupportChatWebhookBody(rawBody);

      if (!event) {
        return res.status(400).json({ ok: false });
      }

      try {
        if (event.event === "customer_message_received") {
          const messageId = event.messageId;
          if (typeof messageId !== "string" || messageId === "") {
            return res.status(400).json({ ok: false });
          }

          // messageId is the idempotency key. A retried delivery claims
          // false and is still acked 200 (so the sender stops retrying)
          // but the handler doesn't run a second time.
          const isNewMessage = await claimMessageId(messageId);
          if (isNewMessage) {
            // Not awaited — a slow/unreachable cx-agent must never delay
            // or fail the 200 we owe CrazyBet for this webhook. Errors are
            // caught and logged inside forwardToCxAgent itself.
            void forwardToCxAgent(event);
            await handleCustomerMessageReceived(event);
          }
        }
        // Any other event type is acknowledged but not acted on yet — new
        // event types can be added here as they're confirmed real.
        res.status(200).json({ ok: true });
      } catch (err) {
        console.error("POST /support-chat/webhook handler failed:", err);
        res.status(500).json({ ok: false });
      }
    }
  );

  // Proxy to the external Support Chat API's conversation history — Lovable
  // calls this (not the external API directly) so the API key stays
  // server-side only. Straight pass-through: no envelope wrapping, no
  // reshaping, just whatever the client function returns.
  router.get("/support-chat/conversations/:id/messages", async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const before = typeof req.query.before === "string" ? req.query.before : undefined;

    try {
      const messages = await fetchConversationMessages(id, limit, before);
      res.json(messages);
    } catch (err) {
      if (err instanceof SupportChatApiError) {
        res.status(err.status ?? 502).json({ error: err.message });
      } else {
        console.error(`GET /support-chat/conversations/${id}/messages failed:`, err);
        res.status(500).json({ error: "internal error" });
      }
    }
  });

  // Proxy for Lovable to send an agent reply. req.body is passed straight
  // through to sendMessage as-is (body/paymentRef/userId/conversationId/
  // clientMessageId) — no validation beyond what the external API itself
  // does, same "pass straight through" reasoning as the route above.
  router.post("/support-chat/messages", express.json(), async (req: Request, res: Response) => {
    try {
      const message = await sendSupportChatMessage(req.body as SendMessageOptions);
      res.json(message);
    } catch (err) {
      if (err instanceof SupportChatApiError) {
        res.status(err.status ?? 502).json({ error: err.message });
      } else {
        console.error("POST /support-chat/messages failed:", err);
        res.status(500).json({ error: "internal error" });
      }
    }
  });

  return router;
}

export const supportChatRouter = createSupportChatRouter();
