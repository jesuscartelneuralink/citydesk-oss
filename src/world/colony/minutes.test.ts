import assert from "node:assert/strict";
import { test } from "node:test";
import { appendMinute, COUNCIL_MINUTES, type Minute } from "./minutes.ts";

test("the first three council minutes are already recorded", () => {
  assert.deepEqual(COUNCIL_MINUTES, [
    {
      id: "m-market",
      by: "Pane",
      text: "The market stall hour stays in daylight.",
      reason: "A public stall needs a posted hour.",
    },
    {
      id: "m-tap",
      by: "Ada",
      text: "The standpipe card stays until the tap runs.",
      reason: "A dry tap is a public need.",
    },
    {
      id: "m-bench",
      by: "Sade",
      text: "The noon bench stays a public seat.",
      reason: "The bench is not a house.",
    },
  ]);
});

test("an empty reason throws", () => {
  const item: Minute = {
    id: "m-lane",
    by: "Pane",
    text: "The lane stays public.",
    reason: "",
  };
  assert.throws(() => appendMinute(COUNCIL_MINUTES, item));
  assert.throws(() => appendMinute(COUNCIL_MINUTES, { ...item, reason: "   " }));
  assert.equal(COUNCIL_MINUTES.length, 3);
});

test("a payout sentence throws", () => {
  const item: Minute = {
    id: "m-pay",
    by: "Ada",
    text: "The stall posts a payout for the hour.",
    reason: "A public stall needs a posted hour.",
  };
  assert.throws(() => appendMinute(COUNCIL_MINUTES, item));
  assert.equal(COUNCIL_MINUTES.length, 3);
});

test("a clean minute returns a new list", () => {
  const item: Minute = {
    id: "m-lane",
    by: "Sade",
    text: "The lane stays a public way.",
    reason: "A lane is not a house.",
  };
  const next = appendMinute(COUNCIL_MINUTES, item);
  assert.equal(next.length, 4);
  assert.equal(next[3], item);
  assert.equal(COUNCIL_MINUTES.length, 3);
});
