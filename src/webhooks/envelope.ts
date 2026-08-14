import express from "express";
import type { Request, Response, NextFunction } from "express";
import { logRawEvent } from "./raw-log.js";

// Confirmed with Satyam (his own signature-verification example): webhooks
// arrive wrapped in an envelope — event, eventId, timestamp, data — NOT the
// flat per-domain shape docs/tech-crm-webhooks.pdf documents (that doc
// matches the older, superseded README instead). `data` holds the same
// per-domain fields the old flat body used to carry at its root.
export type WebhookEnvelope = {
  event: string;
  eventId: string;
  timestamp: string;
  data: any;
};

declare global {
  namespace Express {
    interface Request {
      // Raw bytes of the request body, exactly as received — needed for
      // HMAC verification (see auth.ts). Set by rawBodyParser below.
      rawBodyBuffer?: Buffer;
      // The parsed envelope, if the body parsed as JSON. Set by
      // logIncomingEnvelope below. Undefined if parsing failed.
      webhookEnvelope?: WebhookEnvelope;
    }
  }
}

// Captures raw bytes instead of parsing JSON directly — HMAC verification
// needs the exact original bytes, not a re-serialized object, and this must
// run before anything else touches the body.
//
// type: () => true (not "application/json") deliberately accepts every
// Content-Type. express.raw() only populates req.body when the request's
// Content-Type matches its `type` option — anything else leaves req.body
// undefined, and downstream code crashed on that in testing (a request with
// Content-Type: text/plain 500'd trying to call .toString() on undefined).
// We don't actually care what Content-Type real traffic sends; we just need
// the bytes.
export const rawBodyParser = express.raw({ type: () => true });

// Always persists the raw event, regardless of what happens next — even an
// invalid signature. Only further processing (not logging) is gated on
// signature verification, which runs after this (see auth.ts, index.ts).
export async function logIncomingEnvelope(req: Request, res: Response, next: NextFunction) {
  // Defensive: even with the type:()=>true matcher above, fall back to an
  // empty buffer rather than crash if req.body is ever not a Buffer for
  // some other reason (e.g. an empty body, or a body-parsing edge case).
  const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  req.rawBodyBuffer = rawBuffer;

  let envelope: WebhookEnvelope | null = null;
  try {
    envelope = JSON.parse(rawBuffer.toString("utf8"));
  } catch {
    envelope = null;
  }
  req.webhookEnvelope = envelope ?? undefined;

  const eventName = envelope?.event ?? null;
  const eventId = envelope?.eventId ?? null;
  // Most events carry data.userId (payments/bets) or data.user._id (bonuses'
  // shared user object). /users is the odd one out — data IS the user
  // object itself (see users.ts), so its own _id is the user id. Gate that
  // fallback on the route, not a guessed event-name string: we know for
  // certain what hits POST /users, but not the exact literal Satyam's
  // system sends for it. For every other route, data._id is some other
  // domain object's own id (a payment, a bet, ...), not the user's, and
  // must not be mistaken for it here.
  const userId =
    envelope?.data?.userId ??
    envelope?.data?.user?._id ??
    (req.path === "/users" ? envelope?.data?._id : undefined) ??
    null;
  // If parsing failed, log what we actually received rather than nothing —
  // the payload column is NOT NULL and this keeps the raw bytes visible
  // for debugging a malformed delivery.
  const payload = envelope ?? { _unparsed_raw_body: rawBuffer.toString("utf8") };

  try {
    await logRawEvent(req.path, eventName, userId, eventId, payload);
  } catch (err) {
    // Must never crash the process, but also must never silently swallow —
    // log server-side so a persistence failure is at least visible.
    console.error(`failed to persist raw webhook event for ${req.path}:`, err);
  }

  next();
}
