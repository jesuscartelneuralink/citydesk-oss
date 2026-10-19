import assert from "node:assert/strict";
import { base58Length, checkAddress } from "./addresses.ts";
import { CATALOG, CURRENT_PHASE, openForPhase } from "./catalog.ts";
import {
  citizensFrom,
  PROMINENT_PERKS,
  statusFor,
  welcomeLine,
  workCharterHolds,
} from "./citizens.ts";
import { canMove, dollars, totalsFrom, validCents } from "./ledger.ts";
import * as work from "./work.ts";
import { SPEND_CAP_CENTS, WITHDRAW_ENABLED, workEffective, workEnvAllowed } from "./work.ts";

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

// Kill switch: env default OFF; work runs only when env AND the admin switch are on.
assert.equal(workEnvAllowed({}), false);
assert.equal(workEnvAllowed({ COLONY_WORK_ENABLED: "on" }), true);
assert.equal(workEnvAllowed({ COLONY_WORK_ENABLED: "yes please" }), false);
assert.equal(workEffective(false, true), false);
assert.equal(workEffective(true, false), false);
assert.equal(workEffective(true, true), true);

// Hard limits: spend cap 0, no withdraw, no send/sign/transfer exports.
assert.equal(SPEND_CAP_CENTS, 0);
assert.equal(WITHDRAW_ENABLED, false);
assert.deepEqual(
  Object.keys(work).filter((name) => /withdraw|transfer|send|sign/i.test(name)),
  ["WITHDRAW_ENABLED"],
);
assert.equal(workCharterHolds(), true);
assert.equal(citizensFrom().length, 24);
assert.ok(citizensFrom().every((row) => row.spendCapCents === 0 && row.status === "resident"));

// Ledger rules: integer cents, allowed moves, pending never counts, 1 cleared cent -> Prominent.
assert.equal(validCents(1), true);
assert.equal(validCents(0), false);
assert.equal(validCents(1.5), false);
assert.equal(validCents(-3), false);
assert.equal(canMove("pending", "cleared"), true);
assert.equal(canMove("pending", "reversed"), true);
assert.equal(canMove("cleared", "reversed"), true);
assert.equal(canMove("cleared", "pending"), false);
assert.equal(canMove("reversed", "cleared"), false);
const rows = [
  { citizenId: "ph-kemi", state: "pending" as const, amountCents: 5 },
  { citizenId: "ph-kemi", state: "cleared" as const, amountCents: 1 },
  { citizenId: "ph-kemi", state: "reversed" as const, amountCents: 2 },
];
const totals = totalsFrom(rows, "ph-kemi");
assert.deepEqual(totals, { cleared: 1, pending: 5, reversed: 2 });
assert.equal(statusFor(0), "resident");
assert.equal(statusFor(1), "prominent");
const kemi = citizensFrom(new Map([["ph-kemi", totals]])).find(
  (row) => row.citizenId === "ph-kemi",
);
assert.equal(kemi?.status, "prominent");
assert.deepEqual(kemi?.perks, PROMINENT_PERKS);
assert.equal(kemi?.openProposalLimit, 2);
assert.equal(
  citizensFrom(new Map([["ph-kemi", { cleared: 0, pending: 9, reversed: 0 }]]))[0].status,
  "resident",
  "pending never counts",
);
assert.match(welcomeLine("ph-kemi"), /Kemi earned a first real cent/);
assert.equal(dollars(1), "$0.01");
assert.equal(dollars(12345), "$123.45");

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
assert.equal(
  checkAddress("solana", sixtyFour).ok,
  false,
  "a 64-byte value is key-shaped and refused",
);

// Catalog.
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

console.log("work system holds");
