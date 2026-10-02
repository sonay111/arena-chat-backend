import "dotenv/config";
import type { SupportChatWebhookEvent } from "./webhook.js";

// Forwards a freshly-claimed customer_message_received event to Palig's
// cx-agent, so it can draft/send the AI reply on its own channel (Telegram
// today). Fire-and-forget by design: our receipt of the message (the 200 we
// send CrazyBet from the webhook route) must never depend on whether
// cx-agent is reachable, so every failure here is caught and logged, never
// thrown — there is deliberately nothing for a caller to catch.
export async function forwardToCxAgent(event: SupportChatWebhookEvent): Promise<void> {
  try {
    const url = process.env.CX_AGENT_WEBHOOK_URL;
    const secret = process.env.CX_AGENT_WEBHOOK_SECRET;
    if (!url || !secret) {
      throw new Error("CX_AGENT_WEBHOOK_URL and CX_AGENT_WEBHOOK_SECRET must be set in .env");
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      console.error(`Forward to cx-agent failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error("Forward to cx-agent failed:", err);
  }
}
