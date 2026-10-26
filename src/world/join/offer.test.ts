import assert from "node:assert/strict";
import { test } from "node:test";
import { GETS, REFUSES, offerHolds } from "./offer.ts";

test("the offer is a role and a record, never a payment", () => {
  assert.equal(offerHolds(), true);
  assert.match(GETS[0], /public name/);
  assert.match(REFUSES.join(" "), /No promised return/);
});
