import assert from "node:assert/strict";
import { charterHolds, COLONY, LAWS } from "./charter.ts";
import { citiesHold, CITY_AGENTS } from "./cities.ts";

assert.equal(charterHolds(), true);
assert.equal(citiesHold(), true);
assert.equal(COLONY.operator.name, "Sun");
assert.equal(CITY_AGENTS.length, 24);
assert.ok(LAWS.some((law) => law.includes("No coin is minted")));

console.log("charter holds");

