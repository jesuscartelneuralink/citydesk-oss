import assert from "node:assert/strict";
import { checkWorkProposal, SEED } from "./proposals.ts";

assert.equal(SEED.length, 3);
assert.equal(JSON.stringify(SEED).includes("secret"), false);
const base = {
  citizenId: "ph-kemi",
  workId: "W1",
  job: "Route guide",
  payload: "Draft v1",
  target: "CityDesk",
  expectedCents: 100,
};
const ok = checkWorkProposal(base, 0, 1);
assert.equal(ok.ok, true);
assert.equal(ok.ok && ok.kind, "send");
assert.equal(checkWorkProposal(base, 1, 1).ok, false, "one open at a time");
assert.equal(checkWorkProposal(base, 1, 2).ok, true, "Prominent may hold two");
assert.equal(checkWorkProposal({ ...base, workId: "W7" }, 0, 1).ok, false, "P2 work is closed");
assert.equal(checkWorkProposal({ ...base, workId: "W1" }, 0, 1, 0).ok, false, "W1 is closed in P0");
assert.equal(checkWorkProposal({ ...base, expectedCents: 0.5 }, 0, 1).ok, false);
assert.equal(checkWorkProposal({ ...base, citizenId: "nobody" }, 0, 1).ok, false);

console.log("proposals hold");
