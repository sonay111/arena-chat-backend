import { createServer } from "http";
import express from "express";
import { Server } from "socket.io";
import { pool } from "./db.js";
import { webhooksRouter } from "./webhooks/index.js";

const app = express();
// No express.json() here on purpose — it would consume and parse the raw
// request body for every route. Webhook signature verification needs the
// exact raw bytes, so JSON parsing is applied per-route instead (see
// src/webhooks/*.ts, each route applies its own express.json()).

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("health check failed:", err);
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

app.use(webhooksRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } }); // tighten origin later

// Runs once every time a client (widget or console) connects.
io.on("connection", (socket) => {
  console.log("someone connected:", socket.id);

  // A client asks to join — create a new conversation, or resume an existing one.
  socket.on("join", async ({ playerId, lastMessageId }, ack) => {
    try {
      // PLACEHOLDER — real identity verification goes here later.
      // Confirmed with Satyam: the widget sends a plain Player ID, not a
      // signed token. Trust doesn't come from verifying a signature — it
      // comes from calling the CRM API (src/crm/) with our own key to look
      // up that player id. If the lookup succeeds, the id is real; if it
      // fails, reject the connection (ack({ ok: false })).
      // For now, with no real players yet, we trust the playerId as given
      // without doing that lookup.

      const existing = await pool.query(
        `SELECT * FROM conversations
         WHERE player_id = $1 AND status != 'closed'
         ORDER BY created_at DESC
         LIMIT 1`,
        [playerId]
      );

      const conversation = existing.rows.length > 0
        ? existing.rows[0]
        : (await pool.query(
            `INSERT INTO conversations (player_id, status) VALUES ($1, 'waiting') RETURNING *`,
            [playerId]
          )).rows[0];

      socket.join(`conv_${conversation.id}`);

      // Catch this client up, oldest first. A fresh join has no lastMessageId,
      // so it gets the whole thread. A reconnect sends the id of the last
      // message it already has, so it only gets what it missed while away.
      const history = lastMessageId
        ? await pool.query(
            `SELECT * FROM messages WHERE conversation_id = $1 AND id > $2 ORDER BY created_at ASC`,
            [conversation.id, lastMessageId]
          )
        : await pool.query(
            `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
            [conversation.id]
          );
      socket.emit("history", history.rows);

      if (ack) ack({ ok: true, conversationId: conversation.id, status: conversation.status });
    } catch (err) {
      console.error("join failed:", err);
      if (ack) ack({ ok: false });
    }
  });

  // A client sends a message.
  socket.on("message", async ({ conversationId, senderType, senderId, body }, ack) => {
    try {
      // GOLDEN RULE: persist FIRST.
      const saved = await pool.query(
        `INSERT INTO messages (conversation_id, sender_type, sender_id, body)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [conversationId, senderType, senderId, body]
      );
      const message = saved.rows[0];

      // THEN broadcast to everyone in that conversation's room.
      io.to(`conv_${conversationId}`).emit("message", message);

      // Tell the sender it succeeded (acknowledgement).
      if (ack) ack({ ok: true, message });
    } catch (err) {
      console.error("message failed:", err);
      if (ack) ack({ ok: false });
    }
  });

  socket.on("disconnect", () => console.log("disconnected:", socket.id));
});

httpServer.listen(4000, () => console.log("real-time server on :4000"));
