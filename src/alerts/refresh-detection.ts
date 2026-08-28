import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db.js";
import { rawBodyParser, logIncomingEnvelope } from "../webhooks/envelope.js";
import { verifyWebhookSignature } from "../webhooks/auth.js";

export const refreshAlertsRouter = Router();

// Confirmed 2026-08-25 via real traffic from Satyam's team (v3.arena365.com):
// this arrives as a genuine signed webhook, envelope-wrapped exactly like
// every other CRM webhook — {event, eventId, timestamp, data: {playerId,
// refreshCount, timestamp}} — NOT the flat, unauthenticated body the
// original placeholder assumed. rawBodyParser/logIncomingEnvelope/
// verifyWebhookSignature are the EXACT SAME middleware the other 8 webhook
// routes use (src/webhooks/envelope.ts, src/webhooks/auth.ts) — reused
// here, not reimplemented, applied per-route rather than joining
// webhooksRouter's own mount so this stays self-contained under
// src/alerts/. Still no threshold logic — that's still pending on what
// should actually trigger off this data.
refreshAlertsRouter.post(
  "/alerts/refresh-detected",
  rawBodyParser,
  logIncomingEnvelope,
  verifyWebhookSignature,
  async (req: Request, res: Response) => {
    const data = req.webhookEnvelope?.data;

    if (!data?.playerId) {
      return res.status(400).json({ ok: false, error: "playerId is required" });
    }

    console.log("refresh-detected received:", {
      playerId: data.playerId,
      refreshCount: data.refreshCount,
      timestamp: data.timestamp,
    });

    try {
      await pool.query(
        `INSERT INTO refresh_alerts (player_id, refresh_count, client_timestamp, payload)
         VALUES ($1, $2, $3, $4)`,
        [data.playerId, data.refreshCount ?? null, data.timestamp ?? null, JSON.stringify(data)]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("POST /alerts/refresh-detected failed:", err);
      res.status(500).json({ ok: false });
    }
  }
);
