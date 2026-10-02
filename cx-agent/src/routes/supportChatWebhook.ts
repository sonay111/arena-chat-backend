import crypto from 'node:crypto';
import express, { Router } from 'express';
import { config } from '../config';
import { handleCustomerMessage, InboundCustomerMessage } from '../inbound/handleCustomerMessage';

// POST /support-chat/webhook — CrazyBet's Support Chat delivers each message a customer types in
// the widget here, signed with a shared secret (header X-Arena365-Signature = hex HMAC-SHA256 of
// the raw request body). We verify the signature, ignore repeats of the same messageId, answer
// 200 straight away (CrazyBet wants a 2xx within 10 s and only retries ~3 times over ~8 s), and
// let the agent work out and send the reply in the background.
//
// Fails closed: with no SUPPORT_CHAT_WEBHOOK_SECRET configured, every request is refused (503).

export function isValidSupportChatSignature(rawBody: Buffer, providedHex: string | undefined, secret: string): boolean {
  if (!providedHex) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

type SupportChatWebhookEvent = {
  event?: string;
  messageId?: string;
  conversationId?: string;
  userId?: string;
  body?: string;
  createdAt?: string;
  brand?: string;
};

const MAX_REMEMBERED_MESSAGES = 5000;

export function createSupportChatWebhookRouter(
  handler: (message: InboundCustomerMessage) => Promise<void> = handleCustomerMessage,
  getSecret: () => string | undefined = () => config.supportChatWebhookSecret,
  seen: Set<string> = new Set<string>()
): Router {
  const router = Router();

  router.post('/webhook', express.raw({ type: () => true }), (req, res) => {
    const secret = getSecret();
    if (!secret) {
      res.status(503).json({ ok: false, error: 'webhook secret not configured' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!isValidSupportChatSignature(rawBody, req.header('x-arena365-signature'), secret)) {
      res.status(401).json({ ok: false });
      return;
    }

    let event: SupportChatWebhookEvent;
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      event = parsed as SupportChatWebhookEvent;
    } catch {
      res.status(400).json({ ok: false, error: 'invalid JSON' });
      return;
    }

    // Only customer messages need an answer; acknowledge anything else so it is not retried.
    if (event.event !== 'customer_message_received') {
      res.status(200).json({ ok: true });
      return;
    }

    const { messageId, userId, body } = event;
    if (typeof messageId !== 'string' || messageId === '') {
      res.status(400).json({ ok: false, error: 'messageId is required' });
      return;
    }

    // At-least-once delivery: a message we already took is acknowledged and not processed again.
    if (seen.has(messageId)) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    if (seen.size >= MAX_REMEMBERED_MESSAGES) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    seen.add(messageId);

    // Nothing to answer (for example an attachment-only message): acknowledge so it is not retried.
    if (typeof userId !== 'string' || userId === '' || typeof body !== 'string' || body.trim() === '') {
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
    handler({ customerId: userId, text: body, messageId }).catch((err) => {
      seen.delete(messageId); // allow a manual replay of this message
      console.error(`support-chat webhook: handling message ${messageId} failed`, err);
    });
  });

  return router;
}

export const supportChatWebhookRouter = createSupportChatWebhookRouter();
