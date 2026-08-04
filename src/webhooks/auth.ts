import type { Request, Response, NextFunction } from "express";

// PLACEHOLDER — we don't yet know how the platform authenticates these
// webhooks; docs/tech-crm-webhooks.pdf doesn't say. Until Satyam's team
// confirms the real method (likely an HMAC signature, like the old CRM
// webhook receiver used), this checks an optional shared-secret header.
//
// WEBHOOK_SHARED_SECRET is empty/unset by default, which skips the check
// entirely — that's what makes local testing with plain curl possible
// before a real secret exists. Once the real method is confirmed, replace
// the body of this function; keep it as the single place every webhook
// route passes through.
export function checkWebhookAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WEBHOOK_SHARED_SECRET;
  if (!expected) return next();

  const provided = req.header("x-webhook-secret");
  if (provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
