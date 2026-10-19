import assert from "node:assert/strict";
import { economyOf, liveStep, type Save } from "./living.ts";

const empty: Save = { balance: 0, notes: ["quiet"], born: [], cursor: 0, at: 0 };
let state = empty;
for (let i = 0; i < 20; i += 1) state = liveStep(state, 1_000 + i);
assert.ok(state.born.length >= 1);
assert.ok(state.born.length <= 8);
assert.ok(state.balance > 0);
assert.ok(state.balance <= 80);
assert.equal(economyOf(state.balance, state.notes) === "quiet", false);
const capped = { ...state, balance: 80, cursor: 4 };
const held = liveStep(capped, 9_000);
assert.ok(held.balance <= 80);

console.log("living holds");
