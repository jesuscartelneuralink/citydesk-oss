import assert from "node:assert/strict";
import { decideProposal, proposals } from "./proposals.ts";

const open = proposals().find((row) => row.id === "ride-kemi");
assert.equal(open?.status, "open");
assert.equal(decideProposal("ride-kemi", "approved"), true);
assert.equal(proposals().find((row) => row.id === "ride-kemi")?.status, "approved");
assert.equal(decideProposal("ride-kemi", "refused"), false);
assert.equal(JSON.stringify(proposals()).includes("secret"), false);

console.log("proposals hold");
