import { createServer } from "http";
import { Server } from "socket.io";
import { pool } from "./db.js";

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } }); // tighten origin later

// Runs once every time a client (widget or console) connects.
io.on("connection", (socket) => {
  console.log("someone connected:", socket.id);

  // A client asks to join — create a new conversation, or resume an existing one.
  socket.on("join", async ({ playerId }, ack) => {
    try {
      // PLACEHOLDER — signed-token verification goes here later.
      // The tech team will pass a signed token instead of a raw playerId (see
      // chat-build-guide.md Part 1.6). When that's ready: verify the token's
      // signature here, reject the connection (ack({ ok: false })) if it's
      // invalid, and only then trust the playerId it contains.
      // For now, with no real players yet, we trust the playerId as given.

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
