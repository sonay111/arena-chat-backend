import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isValidSupportChatSignature, parseSupportChatWebhookBody } from "./webhook.js";

// Same test shape as src/webhooks/auth.test.ts (our own inbound webhook
// receiver's signature tests) — this module deliberately mirrors that
// pattern exactly.

const SECRET = "test-support-chat-signing-secret-not-real";

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("isValidSupportChatSignature: passes when the signature matches the raw body and secret", () => {
  const body = Buffer.from('{"event":"customer_message_received","data":{"conversationId":"c1"}}');
  const signature = sign(body.toString());
  assert.equal(isValidSupportChatSignature(body, signature, SECRET), true);
});

test("isValidSupportChatSignature: fails when the signature was computed with a different secret", () => {
  const body = Buffer.from('{"event":"customer_message_received","data":{}}');
  const signature = sign(body.toString(), "wrong-secret");
  assert.equal(isValidSupportChatSignature(body, signature, SECRET), false);
});

test("isValidSupportChatSignature: fails when the body was tampered with after signing", () => {
  const original = '{"event":"customer_message_received","data":{}}';
  const signature = sign(original);
  const tampered = Buffer.from('{"event":"customer_message_received","data":{"extra":true}}');
  assert.equal(isValidSupportChatSignature(tampered, signature, SECRET), false);
});

test("isValidSupportChatSignature: fails when the signature header is missing", () => {
  const body = Buffer.from('{"event":"customer_message_received","data":{}}');
  assert.equal(isValidSupportChatSignature(body, undefined, SECRET), false);
});

test("isValidSupportChatSignature: fails when the signature is not valid hex", () => {
  const body = Buffer.from('{"event":"customer_message_received","data":{}}');
  assert.equal(isValidSupportChatSignature(body, "not-hex-at-all!!", SECRET), false);
});

test("isValidSupportChatSignature: fails when the signature is valid hex but the wrong length", () => {
  const body = Buffer.from('{"event":"customer_message_received","data":{}}');
  assert.equal(isValidSupportChatSignature(body, "abcd", SECRET), false);
});

test("isValidSupportChatSignature: fails when the signature is empty string", () => {
  const body = Buffer.from('{"event":"customer_message_received","data":{}}');
  assert.equal(isValidSupportChatSignature(body, "", SECRET), false);
});

test("parseSupportChatWebhookBody: parses a real-shaped envelope", () => {
  const body = Buffer.from('{"event":"customer_message_received","data":{"conversationId":"c1","message":"hi"}}');
  const parsed = parseSupportChatWebhookBody(body);
  assert.deepEqual(parsed, { event: "customer_message_received", data: { conversationId: "c1", message: "hi" } });
});

test("parseSupportChatWebhookBody: returns null on invalid JSON, doesn't throw", () => {
  const body = Buffer.from("not json at all");
  assert.equal(parseSupportChatWebhookBody(body), null);
});

test("parseSupportChatWebhookBody: returns null on a valid-JSON-but-non-object body (e.g. a bare string or number)", () => {
  assert.equal(parseSupportChatWebhookBody(Buffer.from('"just a string"')), null);
  assert.equal(parseSupportChatWebhookBody(Buffer.from("42")), null);
});
