import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

function getSigningSecret(): string {
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    throw new Error("WEBHOOK_SIGNING_SECRET is not set in .env");
  }
  return secret;
}

// Confirmed with Satyam: webhooks are HMAC-SHA256 signed. X-Webhook-Signature
// is hex(HMAC-SHA256(raw request body bytes, our signing secret)). Pure
// function (no Express types) so it's directly unit-testable — see
// auth.test.ts.
export function isValidSignature(rawBody: Buffer, providedHex: string | undefined, secret: string): boolean {
  if (!providedHex) return false;

  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
    provided = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }

  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, so check that first — this is still safe (length alone isn't a
  // meaningful timing side-channel for a fixed-length hex digest).
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

// Rejects with 401 on any mismatch or missing signature. Must run after
// envelope.ts's rawBodyParser + logIncomingEnvelope — there's nothing to
// verify without the exact original request bytes, and the raw event must
// already be persisted before we can reject it (see envelope.ts).
export function verifyWebhookSignature(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("X-Webhook-Signature");
  const rawBody = req.rawBodyBuffer;

  // TEMPORARY DIAGNOSTIC LOGGING (2026-10-01) — investigating why every
  // structured table (payments/bets/bonuses/players) stopped receiving
  // writes around Sep 28-30 while raw_webhook_events kept logging
  // normally. Suspect this gate is silently 401ing everything. Remove
  // once root-caused. Never logs the secret or the full signature value.
  const valid = !!rawBody && isValidSignature(rawBody, provided, getSigningSecret());
  console.error(
    `[SIG-DEBUG] path=${req.path} valid=${valid} hasRawBody=${!!rawBody} ` +
    `rawBodyLen=${rawBody?.length ?? 0} providedHeaderPresent=${!!provided} ` +
    `providedLen=${provided?.length ?? 0}`
  );

  if (!valid) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}
