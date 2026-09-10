import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDialingCodeToCountry } from "./dialing-code-to-country.js";

test("maps the codes confirmed against real player data", () => {
  // Real control cases, confirmed 2026-09-10: their countryCode from
  // getUsers correctly correlated with their known real country from
  // their own user.registered event.
  assert.equal(mapDialingCodeToCountry("91"), "IN");
  assert.equal(mapDialingCodeToCountry("374"), "AM");
  assert.equal(mapDialingCodeToCountry("971"), "AE");
  assert.equal(mapDialingCodeToCountry("1868"), "TT");
});

test("an unrecognized code returns undefined — never an error, never a guess", () => {
  assert.equal(mapDialingCodeToCountry("999999"), undefined);
  assert.equal(mapDialingCodeToCountry("7"), undefined, "genuinely ambiguous codes (Russia/Kazakhstan) are deliberately excluded");
  assert.equal(mapDialingCodeToCountry("1"), undefined, "bare NANP code is deliberately excluded — ambiguous across many countries");
});

test("missing/empty countryCode returns undefined, not a crash", () => {
  assert.equal(mapDialingCodeToCountry(undefined), undefined);
  assert.equal(mapDialingCodeToCountry(null), undefined);
  assert.equal(mapDialingCodeToCountry(""), undefined);
});

test("unambiguous NANP sub-codes (distinct from the shared bare '1') still resolve", () => {
  assert.equal(mapDialingCodeToCountry("1876"), "JM");
  assert.equal(mapDialingCodeToCountry("1246"), "BB");
});
