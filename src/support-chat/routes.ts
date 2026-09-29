import express, { Router } from "express";
import type { Request, Response } from "express";
import { verifySupportChatWebhookSignature, parseSupportChatWebhookBody } from "./webhook.js";
import type { SupportChatWebhookEvent } from "./webhook.js";
import { claimMessageId as claimMessageIdDefault } from "./idempotency.js";

// handleCustomerMessageReceived and claimMessageId are both injectable so
// tests can stub them out (assert the handler was called, or force a
// "duplicate" claim) without needing a real downstream consumer or a real
// database — same DI convention as every other router in this project.
export function createSupportChatRouter(
  handleCustomerMessageReceived: (event: SupportChatWebhookEvent) => Promise<void> | void = async () => {},
  claimMessageId: (messageId: string) => Promise<boolean> = claimMessageIdDefault
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
          const messageId = (event.data as Record<string, unknown> | undefined)?.messageId;
          if (typeof messageId !== "string" || messageId === "") {
            return res.status(400).json({ ok: false });
          }

          // messageId is the idempotency key. A retried delivery claims
          // false and is still acked 200 (so the sender stops retrying)
          // but the handler doesn't run a second time.
          const isNewMessage = await claimMessageId(messageId);
          if (isNewMessage) {
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

  return router;
}

export const supportChatRouter = createSupportChatRouter();
