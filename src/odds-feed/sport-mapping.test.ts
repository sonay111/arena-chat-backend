import { test } from "node:test";
import assert from "node:assert/strict";
import { getSportInfo, SPORT_MAPPING } from "./sport-mapping.js";

test("sr:sport:20 maps to Table Tennis with its own color", () => {
  const info = getSportInfo("sr:sport:20");
  assert.equal(info.name, "Table Tennis");
  assert.equal(info.color, "#06B6D4");
});

test("an unmapped sportId falls back to Unknown rather than throwing or guessing", () => {
  const info = getSportInfo("sr:sport:999");
  assert.equal(info.name, "Unknown");
});

test("no sportId at all also falls back to Unknown", () => {
  const info = getSportInfo(undefined);
  assert.equal(info.name, "Unknown");
});

test("every mapped sport has its own distinct color", () => {
  const colors = Object.values(SPORT_MAPPING).map((s) => s.color);
  const distinctColors = new Set(colors);
  assert.equal(colors.length, distinctColors.size, "no two mapped sports should share a color");
});
