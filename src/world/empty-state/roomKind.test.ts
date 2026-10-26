import assert from "node:assert/strict";
import { test } from "node:test";
import { roomKind } from "./roomKind.ts";

test("retail, commercial, shop, supermarket, and kiosk are shops", () => {
  for (const kind of ["retail", "commercial", "shop", "supermarket", "kiosk"]) {
    assert.equal(roomKind(kind), "shop");
    assert.equal(roomKind(kind.toUpperCase()), "shop");
    assert.equal(roomKind(kind[0].toUpperCase() + kind.slice(1)), "shop");
  }
});

test("house, residential, and apartments are homes", () => {
  for (const kind of ["house", "residential", "apartments"]) {
    assert.equal(roomKind(kind), "home");
    assert.equal(roomKind(kind.toUpperCase()), "home");
    assert.equal(roomKind(kind[0].toUpperCase() + kind.slice(1)), "home");
  }
});

test("anything else, including an empty string, is a hall", () => {
  for (const kind of ["", "hall", "office", "school", "warehouse", "apartment", "unknown"]) {
    assert.equal(roomKind(kind), "hall");
  }
  assert.equal(roomKind("HALL"), "hall");
});
