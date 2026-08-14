import { Router } from "express";
import { upsertPlayerFromRegistration } from "./players.js";

export const usersRouter = Router();

// POST /users — fires on registration, right after OTP verification.
//
// OLDER ASSUMED FORMAT (flat, no envelope) — kept for reference in case the
// envelope guess turns out wrong and this needs reverting. Under the old
// assumption the body WAS the user object itself directly, with no
// wrapping key, and raw logging happened per-route right here:
//
//   usersRouter.post("/users", express.json(), async (req, res) => {
//     const body = req.body;
//     await logRawEvent("/users", null, body._id ?? null, body);
//     await upsertPlayerFromRegistration(body);
//     ...
//   });
//
// Confirmed with Satyam (his own verification example): the real shape is
// an envelope — {event, eventId, timestamp, data} — and `data` holds what
// used to be the body root. Raw logging now happens once, globally, in
// envelope.ts before signature verification even runs — not per-route.
usersRouter.post("/users", async (req, res) => {
  const data = req.webhookEnvelope?.data;
  if (!data) {
    // Envelope failed to parse, or carried no data — nothing to act on.
    // Already logged verbatim by logIncomingEnvelope regardless.
    return res.status(400).json({ ok: false });
  }

  try {
    await upsertPlayerFromRegistration(data);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("/users webhook failed:", err);
    res.status(500).json({ ok: false });
  }
});
