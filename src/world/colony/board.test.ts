import assert from "node:assert/strict";
import test from "node:test";
import { OPEN_NEEDS, acceptNeed } from "./board.ts";

test("acceptNeed accepts the three public needs already posted", () => {
  assert.deepEqual(
    OPEN_NEEDS.map((need) => [need.id, need.by, need.text]),
    [
      ["n-stall", "Ada", "Sweep the food stall before the short hour."],
      ["n-tap", "Nuru", "The standpipe card is still up."],
      ["n-bench", "Sade", "The noon bench needs a sitter."],
    ],
  );
  for (const need of OPEN_NEEDS) {
    assert.equal(acceptNeed(need.text), true);
  }
});

test("acceptNeed refuses private places and cash errands", () => {
  assert.equal(acceptNeed("Come to my house"), false);
  assert.equal(acceptNeed("school run"), false);
  assert.equal(acceptNeed("send the payout"), false);
  assert.equal(acceptNeed("hold my seed"), false);
});
