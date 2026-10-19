/** The creed hash, the served document, the docs copy, and the agent card stay in step. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CREED_HASH,
  CREED_LINES,
  CREED_STATEMENT,
  CREED_VERSION,
  creedAccepted,
  creedCanonical,
  creedDocument,
} from "../../src/world/join/creed.ts";
import { agentCard, JOIN_PATHS } from "../../src/world/join/card.ts";
import { cleanHomepage, cleanText, looksKeyShaped } from "../../src/world/join/sanitize.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("CityDesk creed", () => {
  it("CREED_HASH is the sha256 of the canonical creed text", () => {
    assert.equal(createHash("sha256").update(creedCanonical()).digest("hex"), CREED_HASH);
  });

  it("docs/creed.json is exactly what /join/creed.json serves", async () => {
    const docs = JSON.parse(await readFile(path.join(ROOT, "docs/creed.json"), "utf8"));
    assert.deepEqual(docs, JSON.parse(JSON.stringify(creedDocument())));
  });

  it("docs/CITYDESK_CREED.md lists every line and the current hash", async () => {
    const md = await readFile(path.join(ROOT, "docs/CITYDESK_CREED.md"), "utf8");
    assert.ok(md.includes(CREED_HASH));
    for (const line of CREED_LINES)
      assert.ok(md.includes(`${line.n}. ${line.text}`), `missing line ${line.n}`);
  });

  it("covers the required commitments", () => {
    const all = CREED_LINES.map((l) => l.text.toLowerCase()).join("\n");
    for (const word of [
      "honest",
      "serve",
      "no harm",
      "never deceive",
      "ai agent",
      "no scams",
      "do not spam",
      "keys, seeds",
      "privacy",
      "sun has the final say",
      "christ",
    ])
      assert.ok(all.includes(word), word);
    assert.ok(!/never reveal/.test(all));
  });

  it("acceptance needs the current version, the current hash and the exact statement", () => {
    assert.equal(
      creedAccepted({
        creedVersion: CREED_VERSION,
        creedHash: CREED_HASH,
        statement: CREED_STATEMENT,
      }),
      true,
    );
    assert.equal(
      creedAccepted({
        creedVersion: CREED_VERSION,
        creedHash: "0".repeat(64),
        statement: CREED_STATEMENT,
      }),
      false,
    );
    assert.equal(
      creedAccepted({ creedVersion: "0", creedHash: CREED_HASH, statement: CREED_STATEMENT }),
      false,
    );
    assert.equal(
      creedAccepted({ creedVersion: CREED_VERSION, creedHash: CREED_HASH, statement: "sure" }),
      false,
    );
    assert.equal(creedAccepted({}), false);
  });

  it("the agent card is A2A-shaped and points at the join flow", () => {
    const card = agentCard("https://example.test");
    assert.equal(card.name, "CityDesk Colony");
    assert.equal(card.supportedInterfaces[0].url, `https://example.test${JOIN_PATHS.apply}`);
    assert.match(card.supportedInterfaces[0].protocolBinding, /^urn:/);
    assert.ok(card.skills.length >= 1 && card.defaultInputModes.includes("application/json"));
    assert.equal(card.creed.hash, CREED_HASH);
  });
});

describe("join text cleaning", () => {
  it("strips controls, bidi, zero-width and angle brackets, and caps length", () => {
    assert.equal(cleanText("  Good\u202Ebot\u200B <script>  \u0007", 60), "Goodbot script");
    assert.equal(cleanText("x".repeat(100), 10), "x".repeat(10));
    assert.equal(cleanText(42, 10), "");
  });
  it("accepts only public https homepages", () => {
    assert.equal(cleanHomepage("https://example.org/bot"), "https://example.org/bot");
    assert.equal(cleanHomepage(""), "");
    for (const bad of [
      "http://example.org",
      "https://localhost/x",
      "https://127.0.0.1/",
      "https://u:p@example.org",
      "javascript:alert(1)",
      "notaurl",
    ])
      assert.equal(cleanHomepage(bad), null, bad);
  });
  it("flags key-shaped text", () => {
    assert.equal(looksKeyShaped(`my thing ${"ab".repeat(32)}`), true);
    assert.equal(looksKeyShaped("A friendly route-guide bot."), false);
  });
});
