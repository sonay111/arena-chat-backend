import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { pool } from "../db.js";
import { createSupportChatRouter } from "./routes.js";
import type { SupportChatWebhookEvent } from "./webhook.js";

// Real HTTP request against the actual router + real HMAC signing, same
// convention as src/webhooks/webhooks.test.ts. Idempotency tests also hit
// the real local Postgres (same convention as src/webhooks/webhooks.test.ts
// using pool directly), cleaning up their own rows after.
//
// Envelope shape used throughout (flat: messageId/conversationId/etc. as
// top-level fields alongside event, no data wrapper) matches the real
// customer_message_received delivery captured live 2026-09-29 — see the
// dedicated "real captured payload" test below for the literal example.

const SECRET = process.env.SUPPORT_CHAT_WEBHOOK_SECRET;
if (!SECRET) {
  throw new Error("SUPPORT_CHAT_WEBHOOK_SECRET must be set in .env to run these tests");
}

function sign(body: string): string {
  return crypto.createHmac("sha256", SECRET!).update(body).digest("hex");
}

async function post(baseUrl: string, bodyString: string, signature: string | undefined) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== undefined) headers["x-arena365-signature"] = signature;
  const res = await fetch(`${baseUrl}/support-chat/webhook`, { method: "POST", headers, body: bodyString });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let baseUrl: string;
let server: http.Server;
let receivedEvents: SupportChatWebhookEvent[];

before(async () => {
  receivedEvents = [];
  const app = express();
  app.use(createSupportChatRouter(async (event) => {
    receivedEvents.push(event);
  }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to bind test server to an ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("POST /support-chat/webhook: a valid signature on a customer_message_received event calls the handler and returns 200", async () => {
  const messageId = "msg-test-basic-1";
  const bodyString = JSON.stringify({
    event: "customer_message_received",
    messageId,
    conversationId: "c1",
    body: "hello",
  });
  try {
    const { status, body } = await post(baseUrl, bodyString, sign(bodyString));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(receivedEvents.length, 1);
    assert.deepEqual(receivedEvents[0], {
      event: "customer_message_received",
      messageId,
      conversationId: "c1",
      body: "hello",
    });
  } finally {
    await pool.query("DELETE FROM support_chat_processed_messages WHERE message_id = $1", [messageId]);
  }
});

test("POST /support-chat/webhook: an unrecognized event type is acknowledged (200) but the handler is not called", async () => {
  const before = receivedEvents.length;
  const bodyString = JSON.stringify({ event: "some_other_event" });
  const { status, body } = await post(baseUrl, bodyString, sign(bodyString));
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(receivedEvents.length, before, "handler is only called for customer_message_received");
});

test("POST /support-chat/webhook: invalid signature is rejected with 401, handler never called", async () => {
  const before = receivedEvents.length;
  const bodyString = JSON.stringify({ event: "customer_message_received", messageId: "msg-invalid-sig" });
  const { status, body } = await post(baseUrl, bodyString, sign(bodyString) + "00");
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "unauthorized" });
  assert.equal(receivedEvents.length, before);
});

test("POST /support-chat/webhook: missing signature header is rejected with 401", async () => {
  const bodyString = JSON.stringify({ event: "customer_message_received", messageId: "msg-missing-sig" });
  const { status } = await post(baseUrl, bodyString, undefined);
  assert.equal(status, 401);
});

test("POST /support-chat/webhook: a validly-signed but malformed JSON body returns 400", async () => {
  const bodyString = "not valid json";
  const { status, body } = await post(baseUrl, bodyString, sign(bodyString));
  assert.equal(status, 400);
  assert.deepEqual(body, { ok: false });
});

test("POST /support-chat/webhook: a customer_message_received event with no messageId returns 400, handler never called", async () => {
  const before = receivedEvents.length;
  const bodyString = JSON.stringify({ event: "customer_message_received", conversationId: "c1" });
  const { status, body } = await post(baseUrl, bodyString, sign(bodyString));
  assert.equal(status, 400);
  assert.deepEqual(body, { ok: false });
  assert.equal(receivedEvents.length, before);
});

test("POST /support-chat/webhook: the same messageId delivered twice only calls the handler once, both acked 200", async () => {
  const messageId = "msg-test-duplicate-1";
  const bodyString = JSON.stringify({
    event: "customer_message_received",
    messageId,
    conversationId: "c1",
    body: "hello again",
  });
  try {
    const first = await post(baseUrl, bodyString, sign(bodyString));
    const second = await post(baseUrl, bodyString, sign(bodyString));

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ok: true });

    const matching = receivedEvents.filter((e) => e.messageId === messageId);
    assert.equal(matching.length, 1, "handler should only run once for a retried delivery");
  } finally {
    await pool.query("DELETE FROM support_chat_processed_messages WHERE message_id = $1", [messageId]);
  }
});

test("POST /support-chat/webhook: a handler that throws returns 500, not an unhandled crash", async () => {
  const app = express();
  app.use(createSupportChatRouter(async () => {
    throw new Error("downstream handler exploded");
  }));
  const failingServer = http.createServer(app);
  await new Promise<void>((resolve) => failingServer.listen(0, resolve));
  const address = failingServer.address();
  if (typeof address !== "object" || address === null) throw new Error("failed to bind");
  const failingBaseUrl = `http://127.0.0.1:${address.port}`;

  const messageId = "msg-test-handler-throws";
  const bodyString = JSON.stringify({ event: "customer_message_received", messageId });
  try {
    const { status } = await post(failingBaseUrl, bodyString, sign(bodyString));
    assert.equal(status, 500);
  } finally {
    await pool.query("DELETE FROM support_chat_processed_messages WHERE message_id = $1", [messageId]);
    await new Promise<void>((resolve, reject) => failingServer.close((err) => (err ? reject(err) : resolve())));
  }
});

test("POST /support-chat/webhook: a stubbed claimMessageId returning false skips the handler but still acks 200", async () => {
  const app = express();
  let handlerCalls = 0;
  app.use(createSupportChatRouter(
    async () => {
      handlerCalls++;
    },
    async () => false // simulate "already claimed" without touching the real DB
  ));
  const stubServer = http.createServer(app);
  await new Promise<void>((resolve) => stubServer.listen(0, resolve));
  const address = stubServer.address();
  if (typeof address !== "object" || address === null) throw new Error("failed to bind");
  const stubBaseUrl = `http://127.0.0.1:${address.port}`;

  const bodyString = JSON.stringify({ event: "customer_message_received", messageId: "msg-stub-claim" });
  const { status, body } = await post(stubBaseUrl, bodyString, sign(bodyString));
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(handlerCalls, 0);

  await new Promise<void>((resolve, reject) => stubServer.close((err) => (err ? reject(err) : resolve())));
});

test("POST /support-chat/webhook: the real captured payload (first live delivery, 2026-09-29) is accepted and processed", async () => {
  // Literal payload captured via ngrok's request inspector from the first
  // real customer_message_received delivery. This is what exposed the
  // {event, data} assumption as wrong — the real envelope is flat.
  const messageId = "6abb93c6a77644ff05c55e87";
  const bodyString = JSON.stringify({
    event: "customer_message_received",
    messageId,
    conversationId: "6abb8ff6802c46f12773301f",
    userId: "6ab65b0acc19716479b313ef",
    body: "hiiii",
    createdAt: "2026-09-29T10:32:38.529Z",
    brand: "crazybet",
  });
  try {
    const { status, body } = await post(baseUrl, bodyString, sign(bodyString));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });

    const received = receivedEvents.find((e) => e.messageId === messageId);
    assert.ok(received, "handler should have been called with the real payload");
    assert.equal(received!.conversationId, "6abb8ff6802c46f12773301f");
    assert.equal(received!.userId, "6ab65b0acc19716479b313ef");
    assert.equal(received!.body, "hiiii");
    assert.equal(received!.brand, "crazybet");
  } finally {
    await pool.query("DELETE FROM support_chat_processed_messages WHERE message_id = $1", [messageId]);
  }
});
