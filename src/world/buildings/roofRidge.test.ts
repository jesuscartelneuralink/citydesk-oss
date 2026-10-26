import assert from "node:assert/strict";
import { test } from "node:test";
import { ridgeOf } from "./roofRidge.ts";

test("a rectangle wider in longitude returns east", () => {
  // Closed ring. 0.001° longitude at the equator is 111.32 m; the short side is latitude.
  const ring = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.0002],
    [0, 0.0002],
    [0, 0],
  ];
  assert.deepEqual(ridgeOf(ring), { axis: "east", lengthM: 111.32 });
});

test("a taller latitude rectangle returns north", () => {
  const ring = [
    [0, 0],
    [0.0002, 0],
    [0.0002, 0.001],
    [0, 0.001],
    [0, 0],
  ];
  assert.deepEqual(ridgeOf(ring), { axis: "north", lengthM: 110.54 });
});

test("a short ring returns null", () => {
  assert.equal(
    ridgeOf([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]),
    null,
  );
  assert.equal(
    ridgeOf([
      [0, 0],
      [1, 0],
      [0, 1],
    ]),
    null,
  );
});
