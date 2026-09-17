import { test } from "node:test";
import assert from "node:assert/strict";
import { getSportInfo, SPORT_MAPPING } from "./sport-mapping.js";

test("sr:sport:20 maps to Table Tennis with its own color", () => {
  const info = getSportInfo("sr:sport:20");
  assert.equal(info.name, "Table Tennis");
  assert.equal(info.color, "#06B6D4");
});

test("sr:sport:21 maps to Cricket with its own color", () => {
  const info = getSportInfo("sr:sport:21");
  assert.equal(info.name, "Cricket");
  assert.equal(info.color, "#22C55E");
});

test("sr:sport:5 maps to Tennis with its own color", () => {
  const info = getSportInfo("sr:sport:5");
  assert.equal(info.name, "Tennis");
  assert.equal(info.color, "#EAB308");
});

test("sr:sport:1 maps to Football with its own color", () => {
  const info = getSportInfo("sr:sport:1");
  assert.equal(info.name, "Football");
  assert.equal(info.color, "#F97316");
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
