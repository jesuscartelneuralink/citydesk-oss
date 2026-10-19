import assert from "node:assert/strict";
import { auditLog, resetAuditForTests } from "./audit.ts";
import {
  addressesOf,
  addWatchAddress,
  base58Length,
  checkAddress,
  resetAddressesForTests,
} from "./addresses.ts";
import { CATALOG, CURRENT_PHASE, openForPhase } from "./catalog.ts";
import {
  citizen,
  citizens,
  noteStatusChanges,
  PROMINENT_PERKS,
  resetStatusForTests,
  statusFor,
  workCharterHolds,
} from "./citizens.ts";
import {
  clearCredit,
  credit,
  dollars,
  ledgerOf,
  resetLedgerForTests,
  reverseCredit,
  totalsOf,
} from "./ledger.ts";
import { decideProposal, proposals, proposeWork, resetProposalsForTests } from "./proposals.ts";
import * as work from "./work.ts";
import { setWorkSwitchForTests, SPEND_CAP_CENTS, WITHDRAW_ENABLED, workEnabled } from "./work.ts";

const KEMI = "ph-kemi";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes: number[]): string {
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function fresh() {
  setWorkSwitchForTests(null);
  resetAuditForTests();
  resetLedgerForTests();
  resetAddressesForTests();
  resetProposalsForTests();
  resetStatusForTests();
}

// Kill switch: default OFF. Off means no proposal is created and no credit posts.
fresh();
delete process.env.COLONY_WORK_ENABLED;
assert.equal(workEnabled(), false);
assert.equal(
  credit("sun", {
    citizenId: KEMI,
    jobId: "w3-1",
    source: "internal",
    ref: "draft",
    amountCents: 5,
  }),
  null,
);
const blocked = proposeWork({
  citizenId: KEMI,
  workId: "W3",
  job: "Draft",
  payload: "text",
  target: "Mantle",
  expectedCents: 1,
});
assert.equal(blocked.ok, false);
assert.equal(ledgerOf(KEMI).length, 0);
assert.equal(proposals().filter((row) => row.citizenId).length, 0);
assert.ok(auditLog().some((row) => row.action === "work.blocked"));
process.env.COLONY_WORK_ENABLED = "on";
assert.equal(workEnabled(), true);
delete process.env.COLONY_WORK_ENABLED;
assert.equal(workEnabled(), false);

// Hard limits: spend cap 0, no withdraw, no send/sign/transfer exports anywhere in work.ts.
assert.equal(SPEND_CAP_CENTS, 0);
assert.equal(WITHDRAW_ENABLED, false);
assert.deepEqual(
  Object.keys(work).filter((name) => /withdraw|transfer|send|sign/i.test(name)),
  ["WITHDRAW_ENABLED"],
);
assert.equal(workCharterHolds(), true);
assert.ok(citizens().every((row) => row.spendCapCents === 0));
assert.equal(citizens().length, 24);

// Ledger: pending never counts; 1 cleared cent -> Prominent; reversed -> back to resident.
fresh();
setWorkSwitchForTests(true);
assert.equal(statusFor(0), "resident");
assert.equal(statusFor(1), "prominent");
assert.equal(
  credit("kemi", { citizenId: KEMI, jobId: "x", source: "internal", ref: "", amountCents: 1 }),
  null,
  "only Sun credits",
);
assert.equal(
  credit("sun", { citizenId: KEMI, jobId: "x", source: "internal", ref: "", amountCents: 1.5 }),
  null,
  "integer cents only",
);
assert.equal(
  credit("sun", { citizenId: KEMI, jobId: "x", source: "internal", ref: "", amountCents: 0 }),
  null,
);
const entry = credit("sun", {
  citizenId: KEMI,
  jobId: "w3-1",
  source: "internal",
  ref: "handover checklist draft",
  amountCents: 1,
});
assert.ok(entry);
assert.equal(entry.state, "pending");
assert.deepEqual(totalsOf(KEMI), { cleared: 0, pending: 1, reversed: 0 });
assert.equal(citizen(KEMI)?.status, "resident");
assert.equal(clearCredit("kemi", entry.id), false, "only Sun clears");
assert.equal(clearCredit("sun", entry.id), true);
assert.equal(clearCredit("sun", entry.id), false, "cannot clear twice");
assert.equal(citizen(KEMI)?.status, "prominent");
assert.deepEqual(citizen(KEMI)?.perks, PROMINENT_PERKS);
assert.equal(citizen(KEMI)?.openProposalLimit, 2);
const welcome = noteStatusChanges();
assert.equal(welcome.length, 1);
assert.match(welcome[0], /Kemi earned a first real cent/);
assert.equal(reverseCredit("sun", entry.id), true);
assert.equal(citizen(KEMI)?.status, "resident");
assert.deepEqual(totalsOf(KEMI), { cleared: 0, pending: 0, reversed: 1 });
assert.equal(dollars(1), "$0.01");
assert.equal(dollars(12345), "$123.45");
assert.ok(auditLog().some((row) => row.action === "ledger.cleared"));
assert.ok(auditLog().some((row) => row.action === "status.changed"));
// Switch off: clearing a pending credit is refused, reversal still allowed.
const second = credit("sun", {
  citizenId: KEMI,
  jobId: "w3-2",
  source: "internal",
  ref: "",
  amountCents: 3,
});
assert.ok(second);
setWorkSwitchForTests(false);
assert.equal(clearCredit("sun", second.id), false);
assert.equal(reverseCredit("sun", second.id), true);

// Audit log is append-only and its rows are frozen.
const firstRow = auditLog()[0];
assert.throws(() => {
  (firstRow as { detail: string }).detail = "edited";
});
const seqs = auditLog().map((row) => row.seq);
assert.deepEqual(
  seqs,
  [...seqs].sort((a, b) => a - b),
);

// Watch-only addresses: public-address format only, Sun only, key-shaped values refused and not logged.
fresh();
assert.equal(checkAddress("evm", "0x000000000000000000000000000000000000dEaD").ok, true);
assert.equal(checkAddress("evm", "0x1234").ok, false);
const hex64 = "ab".repeat(32);
assert.equal(checkAddress("evm", hex64).ok, false);
assert.equal(checkAddress("evm", `0x${hex64}`).ok, false);
assert.equal(checkAddress("evm", "word ".repeat(12).trim()).ok, false);
assert.equal(base58Length("11111111111111111111111111111111"), 32);
assert.equal(checkAddress("solana-devnet", "So11111111111111111111111111111111111111112").ok, true);
assert.equal(checkAddress("solana", "not-base58-0OIl").ok, false);
const sixtyFour = b58(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256));
assert.equal(base58Length(sixtyFour), 64);
const refused = addWatchAddress("sun", KEMI, "solana", sixtyFour);
assert.equal(refused.ok, false);
assert.equal(addressesOf(KEMI).length, 0);
assert.equal(
  JSON.stringify(auditLog()).includes(sixtyFour),
  false,
  "a refused value is never logged",
);
assert.equal(
  addWatchAddress("kemi", KEMI, "evm", "0x000000000000000000000000000000000000dEaD").ok,
  false,
);
assert.equal(
  addWatchAddress("sun", "nobody", "evm", "0x000000000000000000000000000000000000dEaD").ok,
  false,
);
assert.equal(
  addWatchAddress("sun", KEMI, "evm", "0x000000000000000000000000000000000000dEaD").ok,
  true,
);
assert.equal(
  addWatchAddress("sun", KEMI, "evm", "0x000000000000000000000000000000000000dead").ok,
  false,
  "no duplicates",
);
assert.equal(addressesOf(KEMI).length, 1);
assert.ok(auditLog().some((row) => row.action === "address.added"));

// Catalog and proposals: every outward action waits for Sun; only Sun decides; no re-deciding.
fresh();
assert.equal(CATALOG.length, 7);
assert.deepEqual(
  openForPhase(0).map((row) => row.id),
  ["W3"],
);
assert.deepEqual(
  openForPhase(CURRENT_PHASE)
    .map((row) => row.id)
    .sort(),
  ["W1", "W2", "W3"],
);
setWorkSwitchForTests(true);
assert.equal(
  proposeWork({
    citizenId: KEMI,
    workId: "W7",
    job: "Bounty",
    payload: "",
    target: "",
    expectedCents: 0,
  }).ok,
  false,
  "P2 work is closed",
);
assert.equal(
  proposeWork({
    citizenId: KEMI,
    workId: "W3",
    job: "x",
    payload: "",
    target: "",
    expectedCents: 0.5,
  }).ok,
  false,
);
const filed = proposeWork({
  citizenId: KEMI,
  workId: "W1",
  job: "Route guide for a visitor",
  payload: "Draft text v1",
  target: "CityDesk",
  expectedCents: 100,
});
assert.ok(filed.ok);
assert.equal(filed.proposal.status, "open");
assert.equal(filed.proposal.kind, "send");
assert.equal(
  proposeWork({
    citizenId: KEMI,
    workId: "W3",
    job: "Second",
    payload: "",
    target: "",
    expectedCents: 0,
  }).ok,
  false,
  "one open at a time",
);
assert.equal(
  proposeWork({
    citizenId: KEMI,
    workId: "W3",
    job: "Second",
    payload: "",
    target: "",
    expectedCents: 0,
    openLimit: 2,
  }).ok,
  true,
  "Prominent may hold two",
);
assert.equal(decideProposal(filed.proposal.id, "approved", "kemi"), false, "only Sun decides");
assert.equal(decideProposal(filed.proposal.id, "approved"), true);
const after = proposals().find((row) => row.id === filed.proposal.id);
assert.equal(after?.status, "approved");
assert.equal(after?.decidedBy, "sun");
assert.equal(decideProposal(filed.proposal.id, "refused"), false, "no re-deciding");
assert.equal(ledgerOf(KEMI).length, 0, "approving never credits or pays");
assert.ok(auditLog().some((row) => row.action === "proposal.created"));
assert.ok(auditLog().some((row) => row.action === "proposal.decided"));

setWorkSwitchForTests(null);
console.log("work system holds");
