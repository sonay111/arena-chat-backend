import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isValidSignature } from "./auth.js";

const SECRET = "test-signing-secret-not-real";

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("passes when the signature matches the raw body and secret", () => {
  const body = Buffer.from('{"event":"user.registered","eventId":"evt_1","data":{}}');
  const signature = sign(body.toString());
  assert.equal(isValidSignature(body, signature, SECRET), true);
});

test("fails when the signature was computed with a different secret", () => {
  const body = Buffer.from('{"event":"user.registered","eventId":"evt_1","data":{}}');
  const signature = sign(body.toString(), "wrong-secret");
  assert.equal(isValidSignature(body, signature, SECRET), false);
});

test("fails when the body was tampered with after signing", () => {
  const original = '{"event":"user.registered","eventId":"evt_1","data":{}}';
  const signature = sign(original);
  const tampered = Buffer.from('{"event":"user.registered","eventId":"evt_1","data":{"extra":true}}');
  assert.equal(isValidSignature(tampered, signature, SECRET), false);
});

test("fails when the signature header is missing", () => {
  const body = Buffer.from('{"event":"user.registered","eventId":"evt_1","data":{}}');
  assert.equal(isValidSignature(body, undefined, SECRET), false);
});

test("fails when the signature is not valid hex", () => {
  const body = Buffer.from('{"event":"user.registered","eventId":"evt_1","data":{}}');
  assert.equal(isValidSignature(body, "not-hex-at-all!!", SECRET), false);
});

test("fails when the signature is valid hex but the wrong length", () => {
  const body = Buffer.from('{"event":"user.registered","eventId":"evt_1","data":{}}');
  assert.equal(isValidSignature(body, "abcd", SECRET), false);
});

test("fails when the signature is empty string", () => {
  const body = Buffer.from('{"event":"user.registered","eventId":"evt_1","data":{}}');
  assert.equal(isValidSignature(body, "", SECRET), false);
});
