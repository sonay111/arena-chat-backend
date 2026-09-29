import "dotenv/config";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

function getWebhookSecret(): string {
  const secret = process.env.SUPPORT_CHAT_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("SUPPORT_CHAT_WEBHOOK_SECRET is not set in .env");
  }
  return secret;
}

// Same HMAC-SHA256-over-the-raw-request-body pattern as
// src/webhooks/auth.ts's isValidSignature (our own inbound webhook
// receiver) — pure function, directly unit-testable without an Express
// request at all.
export function isValidSupportChatSignature(
  rawBody: Buffer,
  providedHex: string | undefined,
  secret: string
): boolean {
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

  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

export type SupportChatWebhookEvent = {
  event: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
};

// Confirmed via the Support Chat API doc: the signature header is
// X-Arena365-Signature — a different name than our own outbound webhook
// convention (X-Webhook-Signature), since this is a different platform.
// Header lookup via req.header() is case-insensitive, so the lowercase
// constant here matches the documented casing either way.
const SIGNATURE_HEADER = "x-arena365-signature";

// Rejects with 401 on any mismatch or missing signature. Must run after
// something has captured the raw request bytes (e.g. express.raw()) —
// there's nothing to verify without the exact original bytes, same
// requirement as our own webhook receiver.
export function verifySupportChatWebhookSignature(req: Request, res: Response, next: NextFunction) {
  const provided = req.header(SIGNATURE_HEADER);
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  if (!isValidSupportChatSignature(rawBody, provided, getWebhookSecret())) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}

// Parses the raw body into the envelope — only meaningful to call after
// verifySupportChatWebhookSignature has already passed. Returns null on
// invalid JSON rather than throwing, so the caller can respond 400 instead
// of 500ing on a malformed (but signature-valid) delivery.
export function parseSupportChatWebhookBody(rawBody: Buffer): SupportChatWebhookEvent | null {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as SupportChatWebhookEvent) : null;
  } catch {
    return null;
  }
}
