import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config';
import { handleCustomerMessage, InboundCustomerMessage } from '../inbound/handleCustomerMessage';

// POST /support-chat/inbound — called by arena-chat-backend, NOT by the
// Support Chat platform directly. The backend already verifies the
// platform's signature and de-duplicates by messageId, then forwards each
// customer message here with a shared secret.
//
// Two shapes are accepted, so it works with the backend's forwarder as built:
//   auth:  "Authorization: Bearer <secret>"  (the backend's format)  OR  "x-cx-agent-secret: <secret>"
//   body:  CrazyBet's own payload {event, messageId, userId, body, ...}  OR  {customerId, text, messageId?}
//
// Fails closed: with no CX_AGENT_INBOUND_SECRET configured, every request is
// rejected (503), so a forgotten setting can never leave this open.

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The shared secret as sent by the caller: Bearer token first, then the custom header.
function providedSecret(authorization: string | undefined, customHeader: string | undefined): string | undefined {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || customHeader;
}

export function createSupportChatInboundRouter(
  handler: (message: InboundCustomerMessage) => Promise<void> = handleCustomerMessage,
  getSecret: () => string | undefined = () => config.inboundSecret,
  seen: Set<string> = new Set<string>()
): Router {
  const router = Router();

  router.post('/inbound', (req, res) => {
    const secret = getSecret();
    if (!secret) {
      res.status(503).json({ ok: false, error: 'inbound secret not configured' });
      return;
    }
    if (!secretMatches(providedSecret(req.header('authorization'), req.header('x-cx-agent-secret')), secret)) {
      res.status(401).json({ ok: false });
      return;
    }

    const payload = (req.body ?? {}) as Record<string, unknown>;

    // A forwarded CrazyBet event for something other than a customer message needs no answer.
    if (typeof payload.event === 'string' && payload.event !== 'customer_message_received') {
      res.status(200).json({ ok: true });
      return;
    }

    // Either our own shape ({customerId, text}) or CrazyBet's ({userId, body, messageId}).
    const customerId = payload.customerId ?? payload.userId;
    const text = payload.text ?? payload.body;
    const messageId = typeof payload.messageId === 'string' && payload.messageId !== '' ? payload.messageId : undefined;
    if (typeof customerId !== 'string' || customerId === '' || typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ ok: false, error: 'customerId (or userId) and text (or body) are required' });
      return;
    }

    // A re-forward of a message we already took is acknowledged but not answered twice.
    if (messageId) {
      if (seen.has(messageId)) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      if (seen.size >= 5000) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.add(messageId);
    }

    // Answer right away and do the slow part (AI calls) in the background,
    // so the forwarding backend never waits on — or retries because of — a
    // slow model response. Failures are logged, not lost silently.
    res.status(200).json({ ok: true });
    handler({ customerId, text, ...(messageId ? { messageId } : {}) }).catch((err) => {
      if (messageId) seen.delete(messageId);
      console.error(`support-chat inbound: handling message from ${customerId} failed`, err);
    });
  });

  return router;
}

export const supportChatInboundRouter = createSupportChatInboundRouter();
