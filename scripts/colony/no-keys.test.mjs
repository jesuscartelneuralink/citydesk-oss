// CI guard for the colony work system: no private-key or seed material, and no signing or sending
// code paths, may ever appear under src/world/colony or src/world/join (the open join for outside
// bots). Bots never hold keys. Sun signs in his own wallet.
// This file lives outside src/world/colony on purpose, so its own pattern list does not trip it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(ROOT, "src", "world", "colony");
const DIRS = [DIR, path.join(ROOT, "src", "world", "join")];
// The one allowed 64-hex literal: the public sha256 of the creed text (a test recomputes it).
const ALLOWED_SHAPE_LINES = [
  // Either on one line, or wrapped by the formatter onto the line after `export const CREED_HASH =`.
  { file: "src/world/join/creed.ts", line: /^export const CREED_HASH = "[0-9a-f]{64}" as const;$/ },
  { file: "src/world/join/creed.ts", line: /^\s+"[0-9a-f]{64}" as const;$/, after: /^export const CREED_HASH =$/ },
];

const WORDS = [
  /xprv/i,
  /private[_\s-]?key/i,
  /mnemonic/i,
  /seed[_\s-]?phrase/i,
  /fromPhrase/,
  /fromSeed/,
  /createRandom/,
  /Keypair\s*\.\s*generate/,
  /secret[_\s-]?key/i,
  /sendTransaction/,
  /signTransaction/,
  /signMessage/,
  /sendRawTransaction/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /\bwithdraw\s*\(/i,
  /from\s+["'](ethers|@solana\/web3\.js|bip39|tweetnacl|@noble\/[a-z0-9-]+)["']/,
];
// Key-shaped literals: 64 hex chars (with or without 0x), and long base58 runs (87-88 chars).
const SHAPES = [/\b(0x)?[0-9a-fA-F]{64}\b/, /\b[1-9A-HJ-NP-Za-km-z]{85,90}\b/];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

test("src/world/colony and src/world/join hold no key or seed material and no signing code", () => {
  const hits = [];
  for (const file of DIRS.flatMap(files)) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const shapeOk = ALLOWED_SHAPE_LINES.some(
        (a) => a.file === rel && a.line.test(line) && (!a.after || a.after.test(lines[index - 1] ?? "")),
      );
      for (const re of [...WORDS, ...(shapeOk ? [] : SHAPES)]) {
        if (re.test(line)) hits.push(`${rel}:${index + 1} matches ${re}`);
      }
    });
  }
  assert.deepEqual(
    hits,
    [],
    `colony must not contain key material or signing code:\n${hits.join("\n")}`,
  );
});

test("the spend cap is hard-coded to 0 and withdraw is off", () => {
  const src = readFileSync(path.join(DIR, "work.ts"), "utf8");
  assert.match(src, /export const SPEND_CAP_CENTS = 0 as const;/);
  assert.match(src, /export const WITHDRAW_ENABLED = false as const;/);
});

test("the join flow never imports signing or wallet code", () => {
  const join = files(DIRS[1]).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(join, /from\s+["'](ethers|@solana\/web3\.js|bip39|tweetnacl|@noble\/[a-z0-9-]+|viem)["']/);
  assert.doesNotMatch(join, /colony_ledger|colony_addresses/, "members never touch the ledger or addresses");
});

test("the guard itself catches a planted pattern", () => {
  const planted = ["const k = ", "Keypair", ".generate()"].join("");
  assert.ok(WORDS.some((re) => re.test(planted)));
  assert.ok(SHAPES.some((re) => re.test("ab".repeat(32))));
});
