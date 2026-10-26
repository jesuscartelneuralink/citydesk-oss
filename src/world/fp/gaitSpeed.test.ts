import { test } from "node:test";
import assert from "node:assert/strict";
import { gaitSpeed } from "./gaitSpeed.ts";

test("gaitSpeed: 0 stands, 0.5 walks, 1 jogs, NaN stands", () => {
  assert.deepEqual(gaitSpeed(0), { mode: "stand", metresPerSecond: 0 });
  assert.deepEqual(gaitSpeed(0.5), { mode: "walk", metresPerSecond: 1.4 });
  assert.deepEqual(gaitSpeed(1), { mode: "jog", metresPerSecond: 3.2 });
  assert.deepEqual(gaitSpeed(NaN), { mode: "stand", metresPerSecond: 0 });
});
