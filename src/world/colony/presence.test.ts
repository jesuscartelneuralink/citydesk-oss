import assert from "node:assert/strict";
import { PUBLIC_POINTS, presenceHold } from "./presence.ts";

assert.equal(presenceHold(), true);
assert.equal(Object.keys(PUBLIC_POINTS).length, 8);

console.log("presence holds");
