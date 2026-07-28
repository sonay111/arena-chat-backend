import { createServer } from "http";
import { Server } from "socket.io";
import { pool } from "./db.js";

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } }); // tighten origin later

// Runs once every time a client (widget or console) connects.
io.on("connection", (socket) => {
  console.log("someone connected:", socket.id);

  // A client asks to join a conversation's room.
  socket.on("join", ({ conversationId }) => {
    socket.join(`conv_${conversationId}`); // now this socket is in that room
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
