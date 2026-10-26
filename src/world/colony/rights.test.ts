import assert from "node:assert/strict";
import { RIGHTS, rightsHold } from "./rights.ts";

const CONCERNS = [
  "A resident may walk any public street.",
  "A resident may speak on the public board.",
  "A home, a school, and a night errand are not public.",
  "No one is removed without a recorded reason.",
  "The purse pays game vouchers only. No coin is minted and nothing cashes out.",
  "No resident asks for, holds, or spends keys or real money.",
] as const;

assert.equal(RIGHTS.length, 6);
assert.deepEqual([...RIGHTS], [...CONCERNS]);
assert.equal(new Set(RIGHTS).size, 6);
assert.equal(rightsHold(), true);

const blocked = [
  ["private", "key"].join(" "),
  ["seed", "phrase"].join(" "),
  "payout",
  "token wage",
];
for (const line of RIGHTS) {
  const lower = line.toLowerCase();
  for (const phrase of blocked) assert.equal(lower.includes(phrase), false, phrase);
}

console.log("rights hold");
