import express, { Router } from "express";
import { logRawEvent } from "./raw-log.js";
import { upsertPlayerFromRegistration } from "./players.js";

export const usersRouter = Router();

// POST /users — fires on registration, right after OTP verification.
// Unlike every other webhook, the body IS the user object itself (no
// wrapping "user" key, no "wallet" array, no "event" field).
usersRouter.post("/users", express.json(), async (req, res) => {
  const body = req.body;
  try {
    await logRawEvent("/users", null, body._id ?? null, body);
    await upsertPlayerFromRegistration(body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("/users webhook failed:", err);
    res.status(500).json({ ok: false });
  }
});
