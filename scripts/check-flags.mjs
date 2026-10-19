#!/usr/bin/env node
/**
 * NDU-UPG u-113: executable go-live feature-flag checklist.
 *
 * Asserts the SHIPPED production flag values against .grok/app-env.json (the
 * build-time env with-app-env.mjs merges before Vite starts). A wrong value
 * fails the script, so a bad production flag is caught before deploy instead
 * of after.
 *
 * Run: npm run check:flags
 *
 * Flag semantics come from the flag modules themselves (each cited below):
 *  - reception  (workverse/receptionSummary.ts):  default ON;  off only with =off|0
 *  - props      (props/flag.ts):                  off | beta | on   (anything else = off)
 *  - inspect    (inspect/flag.ts):                on only with =on (prod); dev defaults on
 *  - inspect-tap(inspect/flag.ts):                tap-first sub-switch, =on
 *  - collide    (collide/flag.ts):                on only with =on  (default off)
 *  - fp         (fp/flag.ts):                     off | dev | on   (dev = ?fp=1 only)
 *  - immerse    (immerse/flag.ts):                default ON; off only with =off
 *  - assistant  (assistant/flag.ts):              on only with =on  (default off)
 *  - ground     (ground/flag.ts):                 env can only force OFF; the switch
 *                                                  itself is ?ground=1 / localStorage —
 *                                                  env value must NOT be "off" at go-live
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".grok", "app-env.json");

/** Expected go-live values. null = must be absent (module default governs). */
const EXPECTED = {
  VITE_NDU_RECEPTION: "on", // reception desk: marquee go-live feature
  VITE_NDU_PROPS: "on", // street furniture + lighting
  VITE_NDU_INSPECT: "on", // object inspect
  VITE_NDU_INSPECT_TAP: "on", // tap-first inspect interaction
  VITE_NDU_COLLIDE: "on", // avatar collision + doors
  VITE_NDU_FP: "on", // first person
  VITE_NDU_ASSISTANT: null, // assistant stays off until its own review (Sun's call)
  VITE_NDU_IMMERSE: null, // default ON; only "off" would disable it — absence is correct
  VITE_NDU_GROUND: null, // env can only force OFF; absence = UI switch governs (correct at go-live)
  VITE_COLONY_WORK_ENABLED: null, // colony work kill switch: default OFF; turning it on is Sun's call
};

function loadAppEnv() {
  try {
    return JSON.parse(readFileSync(ENV_FILE, "utf8"));
  } catch {
    return {};
  }
}

const env = loadAppEnv();
const problems = [];
const rows = [];

for (const [flag, want] of Object.entries(EXPECTED)) {
  const got = Object.hasOwn(env, flag) ? String(env[flag]) : null;
  const ok = want === null ? got === null || got === undefined : got === want;
  rows.push({
    flag,
    shipped: got === null || got === undefined ? "(unset)" : got,
    expected: want === null ? "unset" : want,
    ok,
  });
  if (!ok) {
    problems.push(
      want === null
        ? `${flag}: expected unset (module default governs), found ${JSON.stringify(got)}`
        : `${flag}: expected ${JSON.stringify(want)}, found ${got === null ? "unset" : JSON.stringify(got)}`,
    );
  }
}

console.log("Go-live feature-flag checklist (.grok/app-env.json):");
for (const r of rows) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.flag.padEnd(24)} shipped=${r.shipped.padEnd(8)} expected=${r.expected}`);
}

if (problems.length) {
  console.error(`\n${problems.length} flag(s) wrong for go-live:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nFix .grok/app-env.json (build-time values) and re-run: npm run check:flags");
  process.exit(1);
}
console.log("\nAll go-live flags match the shipped defaults.");
