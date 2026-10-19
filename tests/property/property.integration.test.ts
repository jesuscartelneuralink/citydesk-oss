/**
 * Integration tests for the NDU property server logic (src/world/property.server.ts) against a REAL
 * scratch Postgres with every migration applied (NDU-4/17/19/20/21/22/25/26/30/38).
 *
 *   TEST_DATABASE_URL=postgres://qa@127.0.0.1:5440/citydesk_qa \
 *     node --experimental-strip-types --import ./tests/property/register.mjs --test tests/property/*.test.ts
 *
 * Safety: refuses any database that is not local, is on 5436 (citydesk-pg, production), or whose
 * name lacks "qa"/"test"/"ci". The KEK and the wallet keypairs are generated in memory per run and
 * are never written to disk or env files. Evidence/scan files go to throwaway temp dirs.
 * Skips (does not fail) when property.server.ts isn't in this tree yet or no TEST_DATABASE_URL is set.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import nacl from "tweetnacl";
import bs58 from "bs58";

type Server = typeof import("../../src/world/property.server.ts");
type Envelope = typeof import("../../src/lib/property/envelope.server.ts");
type Strip = typeof import("../../src/lib/property/strip.server.ts");
type Meta = typeof import("../../src/lib/property/metadata.ts");
type Commit = typeof import("../../src/lib/property/commit.ts");
type Sql = import("../../src/lib/db.ts").Sql;
type Kek = import("../../src/lib/property/envelope.server.ts").Kek;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_FILE = path.join(ROOT, "src/world/property.server.ts");
const DB_URL = process.env.TEST_DATABASE_URL?.trim() ?? "";

/** Returns a reason to refuse, or null when the URL is clearly a local scratch DB. */
export function refuseNonScratch(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "TEST_DATABASE_URL is not a URL";
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)) return "only a local scratch database is allowed";
  if (u.port === "5436") return "port 5436 is citydesk-pg (production) — never test against it";
  if (!/(qa|test|ci)/i.test(u.pathname)) return 'the database name must contain "qa", "test" or "ci"';
  return null;
}

const skip = !existsSync(SERVER_FILE)
  ? "src/world/property.server.ts is not in this tree yet (other bot's work is uncommitted)"
  : !DB_URL
    ? "set TEST_DATABASE_URL to a scratch Postgres to run the property integration tests"
    : false;

// ── fixtures ───────────────────────────────────────────────────────────────

const seg = (marker: number, payload: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
  seg(0xe1, Buffer.from("Exif\0\0GPSLatitude=21.3069;GPSLongitude=-157.8583", "latin1")),
  seg(0xfe, Buffer.from("taken at home", "latin1")),
  seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]),
]);
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
};
const png = (tag: string) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.alloc(13)),
    chunk("tEXt", Buffer.from(`Location\0Kalihi ${tag}`, "latin1")),
    chunk("IDAT", randomBytes(24)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
const pdf = (tag: string) => Buffer.from(`%PDF-1.4\nReceipt: Aloha Appliances $899.00 ${tag}\n%%EOF\n`);

const LAT = 21.306944;
const LNG = -157.858333;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ── shared state ───────────────────────────────────────────────────────────

let S: Server;
let E: Envelope;
let ST: Strip;
let M: Meta;
let C: Commit;
let PROPERTY: { maxItemsPerScan: number; consentVersion: string; inviteHours: number };
let pool: pg.Pool;
let sql: Sql;
let kek: Kek;
let tmp: string;
let scanDir: string;
let evDir: string;
const users: string[] = [];

function newUser(): string {
  const id = `qa-${randomUUID()}`;
  users.push(id);
  return id;
}

async function consent(userId: string, version = PROPERTY.consentVersion) {
  await sql`insert into property_consents (user_id, copy_version) values (${userId}, ${version}) on conflict do nothing`;
}

async function makeScan(userId: string, placed = true): Promise<{ id: string; file: string }> {
  const id = randomUUID();
  const bytes = randomBytes(256);
  const key = `${id}.glb`;
  await writeFile(path.join(scanDir, key), bytes);
  await sql`insert into scan_assets (id, user_id, name, format, bytes, sha256, storage_key, lng, lat)
    values (${id}, ${userId}, ${"room"}, ${"glb"}, ${bytes.length}, ${sha(bytes)}, ${key}, ${placed ? LNG : null}, ${placed ? LAT : null})`;
  return { id, file: path.join(scanDir, key) };
}

async function linkWallet(userId: string) {
  const kp = nacl.sign.keyPair(); // in-memory devnet test wallet; never persisted
  await sql`insert into wallet_links (user_id, address) values (${userId}, ${bs58.encode(kp.publicKey)})`;
  return kp;
}

const signB64 = (kp: nacl.SignKeyPair, message: string) =>
  Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)).toString("base64");

async function rejectsWith(p: Promise<unknown>, status: number, re?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof S.PropertyError, `expected PropertyError, got ${String(err)}`);
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** A consenting user with a linked wallet, a placed scan and one item with receipt + photo. */
async function readyItem(opts: { scope?: "personal" | "family"; groupId?: string; userId?: string } = {}) {
  const userId = opts.userId ?? newUser();
  await consent(userId);
  const wallet = await linkWallet(userId);
  const scan = await makeScan(userId);
  const label = `Grandma's fridge ${randomBytes(3).toString("hex")}`;
  const item = await S.addItem(sql, kek, userId, { scanId: scan.id, label, assetClass: "household", scope: opts.scope ?? "personal", groupId: opts.groupId });
  // Finding F2: buildMetadata rejects names whose 6-char ref has a 5+ digit run (~13% of random refs).
  // Pin a letter-led ref so these tests are deterministic; F2 itself is covered by a `todo` test below.
  await sql`update property_items set record_ref = ${`abcdef${randomBytes(5).toString("hex")}`} where id = ${item.id}`;
  const receipt = await S.storeEvidence(sql, kek, userId, item.id, "receipt", pdf(label));
  const photo = await S.storeEvidence(sql, kek, userId, item.id, "photo", png(label));
  return { userId, wallet, scan, item, label, receipt, photo };
}

async function claimedItem(opts: Parameters<typeof readyItem>[0] = {}) {
  const r = await readyItem(opts);
  const prep = await S.prepareClaim(sql, kek, r.userId, r.item.id);
  const res = await S.submitClaim(sql, kek, r.userId, { itemId: r.item.id, issuedAt: prep.issuedAt, signature: signB64(r.wallet, prep.message) });
  return { ...r, prep, res };
}

const evidenceFile = (id: string) => path.join(evDir, `${id}.bin`);

// ── suite ──────────────────────────────────────────────────────────────────

describe("property server ⇄ scratch Postgres (integration)", { skip }, () => {
  before(async () => {
    const refusal = refuseNonScratch(DB_URL);
    if (refusal) throw new Error(`Refusing to run integration tests: ${refusal}`);
    tmp = await mkdtemp(path.join(os.tmpdir(), "ndu-qa-"));
    scanDir = path.join(tmp, "scans");
    evDir = path.join(tmp, "evidence");
    await mkdir(scanDir, { recursive: true });
    // db.ts picks its backend at import time: point it at the scratch DB so it never boots PGLite.
    process.env.DATABASE_URL = DB_URL;
    process.env.SCAN_STORAGE_DIR = scanDir;
    process.env.PROPERTY_EVIDENCE_DIR = evDir;
    delete process.env.PROPERTY_MINT_ENABLED;

    const mig = spawnSync(process.execPath, ["scripts/migrate.mjs"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8" });
    assert.equal(mig.status, 0, `migrate.mjs failed:\n${mig.stdout}\n${mig.stderr}`);

    S = await import("../../src/world/property.server.ts");
    E = await import("../../src/lib/property/envelope.server.ts");
    ST = await import("../../src/lib/property/strip.server.ts");
    M = await import("../../src/lib/property/metadata.ts");
    C = await import("../../src/lib/property/commit.ts");
    ({ PROPERTY } = await import("../../src/config/neura.ts"));

    // Ephemeral, in-memory KEK for this run only (symmetric data-at-rest key, not a wallet key).
    kek = E.loadKek({ PROPERTY_KEK: randomBytes(32).toString("base64"), PROPERTY_KEK_ID: "qa1" })!;
    assert.ok(kek);

    pg.types.setTypeParser(20, Number);
    pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
    const run = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
    const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0];
      for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
      return run(text, values);
    };
    sql = Object.assign(tagged, { query: run }) as unknown as Sql;
    const t = await sql<{ n: number }>`select count(*)::int as n from _migrations where name = '0010_property_core.sql'`;
    assert.equal(t[0].n, 1, "0010_property_core.sql must be applied");
  });

  after(async () => {
    if (pool && users.length) {
      // Only this run's rows; the scratch DB itself is thrown away afterwards.
      await sql.query(`delete from property_items where user_id = any($1::text[])`, [users]);
      await sql.query(`delete from property_groups where created_by = any($1::text[])`, [users]);
      for (const t of ["property_consents", "property_rate_events", "scan_assets", "wallet_links"]) {
        await sql.query(`delete from ${t} where user_id = any($1::text[])`, [users]);
      }
    }
    await pool?.end();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  describe("feature switch + mint flag (NDU-17/24)", () => {
    it("refuses when PROPERTY_ENABLED is off, 503 without a KEK, ready with one", async () => {
      await withEnv({ PROPERTY_ENABLED: undefined, PROPERTY_KEK: undefined }, () => {
        assert.throws(() => S.requireReady(), (e: unknown) => e instanceof S.PropertyError && e.status === 404);
      });
      await withEnv({ PROPERTY_ENABLED: "true", PROPERTY_KEK: undefined }, () => {
        assert.throws(() => S.requireReady(), (e: unknown) => e instanceof S.PropertyError && e.status === 503);
        assert.ok(S.propertyConfig().missing.some((m) => m.startsWith("PROPERTY_KEK")));
      });
      const value = randomBytes(32).toString("base64");
      await withEnv({ PROPERTY_ENABLED: "true", PROPERTY_KEK: value }, () => {
        const k = S.requireReady();
        assert.equal(k.key.length, 32);
        assert.ok(!JSON.stringify(S.propertyConfig().missing).includes(value), "config must never echo the KEK");
      });
    });
  });

  describe("consent required (NDU-4)", () => {
    it("blocks items and evidence until the CURRENT consent version is accepted", async () => {
      const u = newUser();
      const scan = await makeScan(u);
      const input = { scanId: scan.id, label: "Bike", assetClass: "equipment", scope: "personal" };
      await rejectsWith(S.addItem(sql, kek, u, input), 412);
      await rejectsWith(S.storeEvidence(sql, kek, u, randomUUID(), "photo", png("x")), 412);
      await consent(u, "1999-01-01.0");
      assert.equal(await S.hasConsent(sql, u), false, "an old consent version must not count");
      await rejectsWith(S.addItem(sql, kek, u, input), 412);
      await consent(u);
      assert.equal(await S.hasConsent(sql, u), true);
      const item = await S.addItem(sql, kek, u, input);
      assert.equal(item.status, "draft");
      assert.equal(item.label, "Bike");
    });
  });

  describe("3-items-per-scan cap (NDU-20)", () => {
    it("allows exactly maxItemsPerScan per scan, per owner", async () => {
      assert.equal(PROPERTY.maxItemsPerScan, 3);
      const u = newUser();
      await consent(u);
      const scan = await makeScan(u);
      for (let i = 0; i < 3; i += 1) {
        await S.addItem(sql, kek, u, { scanId: scan.id, label: `item ${i}`, assetClass: "household", scope: "personal" });
      }
      await rejectsWith(S.addItem(sql, kek, u, { scanId: scan.id, label: "item 4", assetClass: "household", scope: "personal" }), 409, /up to 3/);
      const n = await sql<{ n: number }>`select count(*)::int as n from property_items where scan_id = ${scan.id}`;
      assert.equal(n[0].n, 3);
      assert.equal((await S.listItemsForScan(sql, kek, u, scan.id)).length, 3);
      // a different scan has its own budget
      const scan2 = await makeScan(u);
      await S.addItem(sql, kek, u, { scanId: scan2.id, label: "other room", assetClass: "household", scope: "personal" });
      // nobody else can add to (or even see) my scan
      const other = newUser();
      await consent(other);
      await rejectsWith(S.addItem(sql, kek, other, { scanId: scan.id, label: "sneaky", assetClass: "household", scope: "personal" }), 404);
      await rejectsWith(S.listItemsForScan(sql, kek, other, scan.id), 404);
    });

    // Known gap (see docs/qa/0010-dryrun.md, finding F1): the cap is a count-then-insert with no lock,
    // so parallel requests can overshoot it. Marked `todo` so it reports without failing CI.
    it("holds under concurrent adds (race)", { todo: "F1: count-then-insert race in addItem; lock the scan row or use an advisory lock" }, async () => {
      const u = newUser();
      await consent(u);
      const scan = await makeScan(u);
      await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) => S.addItem(sql, kek, u, { scanId: scan.id, label: `race ${i}`, assetClass: "household", scope: "personal" })),
      );
      const n = await sql<{ n: number }>`select count(*)::int as n from property_items where scan_id = ${scan.id}`;
      assert.ok(n[0].n <= PROPERTY.maxItemsPerScan, `cap overshot: ${n[0].n} items on one scan`);
    });

    it("validates class, scope and group membership", async () => {
      const u = newUser();
      await consent(u);
      const scan = await makeScan(u);
      await rejectsWith(S.addItem(sql, kek, u, { scanId: scan.id, label: "x", assetClass: "car", scope: "personal" }), 400);
      await rejectsWith(S.addItem(sql, kek, u, { scanId: scan.id, label: "x", assetClass: "household", scope: "public" }), 400);
      await rejectsWith(S.addItem(sql, kek, u, { scanId: scan.id, label: "x", assetClass: "household", scope: "family", groupId: randomUUID() }), 400);
      await rejectsWith(S.addItem(sql, kek, u, { scanId: scan.id, label: "   ", assetClass: "household", scope: "personal" }), 400);
    });
  });

  describe("encrypted receipts/photos (NDU-19/21)", () => {
    it("strips EXIF, encrypts at rest and round-trips for the owner", async () => {
      const u = newUser();
      await consent(u);
      const scan = await makeScan(u);
      const item = await S.addItem(sql, kek, u, { scanId: scan.id, label: "Secret label 42", assetClass: "household", scope: "personal" });
      const stripped = ST.stripJpeg(JPEG);
      const ev = await S.storeEvidence(sql, kek, u, item.id, "photo", JPEG);
      assert.equal(ev.mime, "image/jpeg");
      assert.equal(ev.sha256, sha(stripped), "digest is over the STRIPPED bytes");
      assert.equal(ev.bytes, stripped.length);

      const onDisk = await readFile(evidenceFile(ev.id));
      assert.ok(!onDisk.includes(Buffer.from("GPSLatitude")), "no GPS on disk");
      assert.ok(!onDisk.includes(Buffer.from("JFIF")), "stored bytes are ciphertext");
      assert.equal((await stat(evidenceFile(ev.id))).mode & 0o777, 0o600);
      assert.deepEqual((await readdir(evDir)).filter((f) => f.endsWith(".part")), [], "no temp files left behind");

      const out = await S.readEvidence(sql, kek, u, ev.id);
      assert.equal(out.mime, "image/jpeg");
      assert.deepEqual(out.bytes, stripped);
      assert.ok(!out.bytes.includes(Buffer.from("GPSLatitude")));

      const row = (await sql<{ dek_wrapped: string; storage_key: string; user_id: string }>`select * from property_item_evidence where id = ${ev.id}`)[0];
      assert.match(row.dek_wrapped, /^v1\.qa1\./);
      assert.equal(row.storage_key, `${ev.id}.bin`, "files are keyed by opaque ids, never user ids");
      const it = (await sql<{ label_enc: string }>`select label_enc from property_items where id = ${item.id}`)[0];
      assert.ok(!it.label_enc.includes("Secret"), "labels are stored wrapped");

      const c = (await sql<{ commitment: string; salt_wrapped: string }>`select * from property_item_commitments where item_id = ${item.id} and kind = 'photo'`)[0];
      assert.ok(C.isHex64(c.commitment));
      assert.equal(c.commitment, await C.commit("photo", E.unwrap(kek, c.salt_wrapped, `salt|${item.id}|photo`), ev.sha256));
    });

    it("stores PDF receipts byte-identical and rejects bad types", async () => {
      const u = newUser();
      await consent(u);
      const scan = await makeScan(u);
      const item = await S.addItem(sql, kek, u, { scanId: scan.id, label: "TV", assetClass: "household", scope: "personal" });
      const doc = pdf("tv");
      const ev = await S.storeEvidence(sql, kek, u, item.id, "receipt", doc);
      assert.deepEqual((await S.readEvidence(sql, kek, u, ev.id)).bytes, doc);
      assert.ok(!(await readFile(evidenceFile(ev.id))).includes(Buffer.from("Aloha Appliances")));
      await rejectsWith(S.storeEvidence(sql, kek, u, item.id, "receipt", Buffer.from("GIF89a....")), 415);
      await rejectsWith(S.storeEvidence(sql, kek, u, item.id, "photo", doc), 415);
      await rejectsWith(S.storeEvidence(sql, kek, u, item.id, "selfie", doc), 400);
      // a wrong KEK fails closed
      const wrong = E.loadKek({ PROPERTY_KEK: randomBytes(32).toString("base64"), PROPERTY_KEK_ID: "qa1" })!;
      await assert.rejects(S.readEvidence(sql, wrong, u, ev.id));
    });

    it("only owner + group members can read; replacing or withdrawing shreds the old file", async () => {
      const owner = newUser();
      const member = newUser();
      const outsider = newUser();
      await consent(owner);
      const g = await S.createGroup(sql, kek, owner, "family", "The Kealohas");
      const inv = await S.createInvite(sql, owner, g.id);
      await S.joinGroup(sql, kek, member, inv.code);
      const scan = await makeScan(owner);
      const item = await S.addItem(sql, kek, owner, { scanId: scan.id, label: "Ukulele", assetClass: "household", scope: "family", groupId: g.id });
      const first = await S.storeEvidence(sql, kek, owner, item.id, "photo", png("one"));

      assert.ok((await S.readEvidence(sql, kek, member, first.id)).bytes.length > 0);
      await rejectsWith(S.readEvidence(sql, kek, outsider, first.id), 404);
      const shared = await S.listSharedItems(sql, kek, member);
      assert.ok(shared.some((s) => s.id === item.id && s.scanId === null), "members never see the owner's scan id");

      const second = await S.storeEvidence(sql, kek, owner, item.id, "photo", png("two"));
      assert.equal(existsSync(evidenceFile(first.id)), false, "replaced file is deleted");
      const old = (await sql<{ storage_key: string | null; dek_wrapped: string | null; shredded_at: Date | null }>`
        select storage_key, dek_wrapped, shredded_at from property_item_evidence where id = ${first.id}`)[0];
      assert.equal(old.storage_key, null);
      assert.equal(old.dek_wrapped, null);
      assert.ok(old.shredded_at);
      await rejectsWith(S.readEvidence(sql, kek, owner, first.id), 404);

      await S.leaveGroup(sql, member, g.id);
      await rejectsWith(S.readEvidence(sql, kek, member, second.id), 404);

      await S.shredEvidence(sql, owner, item.id, "photo");
      assert.equal(existsSync(evidenceFile(second.id)), false);
      const [view] = await S.itemViews(sql, kek, owner, [(await S.loadItem(sql, item.id))!]);
      assert.equal(view.photo.state, "withdrawn");
      const salt = (await sql<{ salt_wrapped: string | null }>`select salt_wrapped from property_item_commitments where item_id = ${item.id} and kind = 'photo'`)[0];
      assert.equal(salt.salt_wrapped, null, "withdrawing destroys the salt too");
    });

    it("delete = crypto-shred of files, rows, salts and commitments", async () => {
      const r = await readyItem();
      await S.deleteItem(sql, r.userId, r.item.id);
      assert.equal(existsSync(evidenceFile(r.receipt.id)), false);
      assert.equal(existsSync(evidenceFile(r.photo.id)), false);
      for (const t of ["property_item_evidence", "property_item_commitments"]) {
        const n = await sql.query<{ n: number }>(`select count(*)::int as n from ${t} where item_id = $1`, [r.item.id]);
        assert.equal(n[0].n, 0, t);
      }
      assert.equal(await S.loadItem(sql, r.item.id), null);
    });
  });

  describe("claim signature verification (NDU-26 minus mint)", () => {
    it("requires a linked wallet, a placed scan and both pieces of evidence", async () => {
      const u = newUser();
      await consent(u);
      const unplaced = await makeScan(u, false);
      const item = await S.addItem(sql, kek, u, { scanId: unplaced.id, label: "Lamp", assetClass: "household", scope: "personal" });
      await rejectsWith(S.prepareClaim(sql, kek, u, item.id), 412, /wallet/i);
      await linkWallet(u);
      await rejectsWith(S.prepareClaim(sql, kek, u, item.id), 409, /Place the room scan/);
      const placed = await makeScan(u);
      const item2 = await S.addItem(sql, kek, u, { scanId: placed.id, label: "Lamp 2", assetClass: "household", scope: "personal" });
      await S.storeEvidence(sql, kek, u, item2.id, "photo", png("lamp"));
      await rejectsWith(S.prepareClaim(sql, kek, u, item2.id), 409, /receipt/);
    });

    it("accepts only the linked wallet's signature over the exact, fresh claim message", async () => {
      const r = await readyItem();
      const prep = await S.prepareClaim(sql, kek, r.userId, r.item.id);
      assert.equal(prep.claimant, bs58.encode(r.wallet.publicKey));
      assert.ok(prep.message.includes(`claim_sha256:${prep.claimHash}`));
      // stable: re-preparing at the same instant yields the same hash (salts are reused)
      const again = await S.prepareClaim(sql, kek, r.userId, r.item.id);
      assert.equal(again.message.split("\n")[0], prep.message.split("\n")[0]);

      const intruder = nacl.sign.keyPair();
      const submit = (signature: string, issuedAt = prep.issuedAt) => S.submitClaim(sql, kek, r.userId, { itemId: r.item.id, issuedAt, signature });
      await rejectsWith(submit(signB64(intruder, prep.message)), 400, /signature/);
      await rejectsWith(submit(signB64(r.wallet, `${prep.message}\nextra`)), 400);
      await rejectsWith(submit("not-a-signature"), 400);
      await rejectsWith(submit(""), 400);
      await rejectsWith(submit(signB64(r.wallet, prep.message), new Date(Date.now() - 16 * 60_000).toISOString()), 409, /expired/);
      await rejectsWith(submit(signB64(r.wallet, prep.message), "2026-10-08"), 409);
      // the room changing after signing invalidates the signature
      await sql`update scan_assets set lat = ${LAT + 0.01} where id = ${r.scan.id}`;
      await rejectsWith(submit(signB64(r.wallet, prep.message)), 400);
      await sql`update scan_assets set lat = ${LAT} where id = ${r.scan.id}`;

      const res = await submit(signB64(r.wallet, prep.message));
      assert.equal(res.status, "awaiting_mint");
      assert.match(res.mintNote, /switched off/);
      const rec = (await sql<Record<string, unknown>>`select * from property_records where id = ${res.recordId}`)[0];
      assert.equal(rec.claimant_address, prep.claimant);
      assert.equal(rec.claim_hash, prep.claimHash);
      assert.equal(rec.claim_message, prep.message);
      assert.equal(rec.cluster, "devnet");
      for (const k of ["asset_id", "tree", "leaf_index", "mint_sig"]) assert.equal(rec[k], null, k);
      const item = (await S.loadItem(sql, r.item.id))!;
      assert.equal(item.claim_status, "claimed_offchain");
      // claimed items are locked
      await rejectsWith(S.updateItem(sql, kek, r.userId, { id: r.item.id, label: "changed" }), 409);
      await rejectsWith(S.storeEvidence(sql, kek, r.userId, r.item.id, "photo", png("late")), 409);
      await rejectsWith(S.prepareClaim(sql, kek, r.userId, r.item.id), 409);
      await rejectsWith(submit(signB64(r.wallet, prep.message)), 409);
    });

    it("claims succeed whatever random record_ref was drawn", { todo: "F2: 'NDU item #<6 hex>' trips the /\\d{5,}/ leak rule for ~13% of refs, so submitClaim throws a raw Error (500)" }, async () => {
      const r = await readyItem();
      await sql`update property_items set record_ref = ${`12345${randomBytes(5).toString("hex")}a`} where id = ${r.item.id}`;
      const prep = await S.prepareClaim(sql, kek, r.userId, r.item.id);
      const res = await S.submitClaim(sql, kek, r.userId, { itemId: r.item.id, issuedAt: prep.issuedAt, signature: signB64(r.wallet, prep.message) });
      assert.equal(res.status, "awaiting_mint");
    });

    it("public metadata leaks nothing private (NDU-25/38 sweep)", async () => {
      const owner = newUser();
      await consent(owner);
      const g = await S.createGroup(sql, kek, owner, "family", "Secret Ohana Name");
      const c = await claimedItem({ userId: owner, scope: "family", groupId: g.id });
      const rec = (await sql<{ metadata_json: string; metadata_json_hash: string; uri: string }>`
        select metadata_json, metadata_json_hash, uri from property_records where id = ${c.res.recordId}`)[0];
      const json = rec.metadata_json;
      const forbidden = [
        c.label,
        "Grandma",
        owner,
        c.item.id,
        c.scan.id,
        g.id,
        "Secret Ohana Name",
        c.receipt.id,
        c.photo.id,
        c.receipt.sha256,
        c.photo.sha256,
        String(LAT).slice(0, 6),
        String(LNG).slice(0, 7),
        C.geohash(LAT, LNG, 7),
        C.geohash(LAT, LNG, 5),
        "Aloha Appliances",
      ];
      for (const f of forbidden) assert.ok(!json.includes(f), `public metadata must not contain ${JSON.stringify(f)}`);
      assert.deepEqual(M.validatePublicMetadata(JSON.parse(json)), []);
      assert.ok(rec.uri.endsWith(`${rec.metadata_json_hash}.json`));
      assert.equal(await S.readMetadata(sql, owner, `${rec.metadata_json_hash}.json`), json);
      await rejectsWith(S.readMetadata(sql, newUser(), rec.metadata_json_hash), 404);
      await rejectsWith(S.readMetadata(sql, owner, "zz"), 404);
    });
  });

  describe("verification card (NDU-30)", () => {
    const statuses = (card: { checks: { n: number; status: string }[] }) => Object.fromEntries(card.checks.map((c) => [c.n, c.status]));

    it("passes every off-chain check for a fresh claim; on-chain checks stay unavailable", async () => {
      const c = await claimedItem();
      const card = await S.verifyItem(sql, kek, c.userId, c.item.id);
      assert.deepEqual(card.checks.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8]);
      assert.deepEqual(statuses(card), { 1: "unavailable", 2: "pass", 3: "pass", 4: "pass", 5: "pass", 6: "pass", 7: "unavailable", 8: "unavailable" });
      for (const x of card.checks.filter((x) => x.status === "pass")) {
        assert.ok(x.proves && x.doesNotProve, `check ${x.n} explains what it does and doesn't prove`);
      }
      assert.equal(card.mintEnabled, false);
      assert.equal(card.record?.status, "awaiting_mint");
      assert.equal(card.record?.assetId, null);
      assert.equal(card.record?.mintSig, null);
      assert.deepEqual(card.commitments.map((x) => x.kind).sort(), ["geo", "photo", "receipt", "scan"]);
      assert.ok(card.disclaimer.length > 0);
      await rejectsWith(S.verifyItem(sql, kek, newUser(), c.item.id), 404);
    });

    it("a draft item: evidence verifies, claim checks unavailable, scan intact but uncommitted", async () => {
      const r = await readyItem();
      const card = await S.verifyItem(sql, kek, r.userId, r.item.id);
      assert.equal(card.record, null);
      assert.deepEqual(statuses(card), { 1: "unavailable", 2: "unavailable", 3: "unavailable", 4: "pass", 5: "pass", 6: "unavailable", 7: "unavailable", 8: "unavailable" });
    });

    it("detects tampered evidence, metadata and scan files; reports withdrawn evidence", async () => {
      const c = await claimedItem();
      const f = evidenceFile(c.receipt.id);
      const bytes = await readFile(f);
      bytes[20] ^= 0xff;
      await writeFile(f, bytes);
      await writeFile(c.scan.file, randomBytes(256));
      await sql`update property_records set metadata_json = metadata_json || ' ' where id = ${c.res.recordId}`;
      await S.shredEvidence(sql, c.userId, c.item.id, "photo");
      const s = statuses(await S.verifyItem(sql, kek, c.userId, c.item.id));
      assert.equal(s[2], "fail", "metadata edited after signing");
      assert.equal(s[4], "fail", "receipt ciphertext tampered");
      assert.equal(s[5], "withdrawn", "photo withdrawn by owner");
      assert.equal(s[6], "fail", "scan file changed");
    });
  });

  describe("mint stub stays OFF (NDU-2 open)", () => {
    it("flag defaults off and the stub always refuses", async () => {
      await withEnv({ PROPERTY_MINT_ENABLED: undefined }, () => {
        assert.equal(S.mintFeatureFlag(), false);
        assert.equal(S.propertyConfig().mintFlag, false);
      });
      await rejectsWith(S.mintCompressedRecordStub(randomUUID()), 501, /NDU-2/);
    });

    it("with PROPERTY_MINT_ENABLED=true the owner anchors from their own wallet; the server mints nothing", async () => {
      // NDU-24/26-29 (f8e4384): the flag now enables user-signed devnet Memo anchoring. The server
      // never signs and never mints; the record stays off-chain until the owner's wallet signs.
      await withEnv({ PROPERTY_MINT_ENABLED: "true" }, async () => {
        assert.equal(S.mintFeatureFlag(), true);
        const c = await claimedItem();
        assert.equal(c.res.status, "awaiting_mint");
        assert.match(c.res.mintNote, /anchor it on Solana devnet from your wallet/);
        const rec = (await sql<Record<string, unknown>>`select * from property_records where id = ${c.res.recordId}`)[0];
        assert.equal(rec.status, "awaiting_mint");
        for (const k of ["asset_id", "tree", "leaf_index", "mint_sig"]) assert.equal(rec[k], null, k);
        const card = await S.verifyItem(sql, kek, c.userId, c.item.id);
        assert.equal(card.mintEnabled, true, "mintEnabled reflects the flag");
        assert.equal(card.checks[0].status, "unavailable", "nothing is on-chain until the owner signs");
        assert.match(card.checks[0].detail, /from their own wallet/);
      });
      await withEnv({ PROPERTY_MINT_ENABLED: undefined }, async () => {
        const c = await claimedItem();
        assert.match(c.res.mintNote, /switched off/);
        const card = await S.verifyItem(sql, kek, c.userId, c.item.id);
        assert.equal(card.mintEnabled, false, "mintEnabled reflects the flag");
      });
      const rows = await sql.query<{ n: number }>(
        `select count(*)::int as n from property_records where user_id = any($1::text[]) and (status <> 'awaiting_mint' or asset_id is not null or mint_sig is not null)`,
        [users],
      );
      assert.equal(rows[0].n, 0);
    });

    it("property.server.ts has no signing, keypair or transaction code", async () => {
      const src = (await readFile(SERVER_FILE, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const re of [/Keypair/, /secretKey/, /fromSecretKey/, /sendTransaction/, /sendRawTransaction/, /signTransaction/, /@metaplex/, /\bumi\b/i, /new Connection\(/]) {
        assert.doesNotMatch(src, re);
      }
    });

    it("the devnet anchor relay never signs: it only forwards a transaction the owner's wallet signed", async () => {
      const file = path.join(ROOT, "src/world/property-anchor.server.ts");
      const src = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const re of [/Keypair/, /secretKey/, /fromSecretKey/, /fromSeed/, /signTransaction/, /partialSign/, /\.sign\(/, /tweetnacl/, /@metaplex/, /\bumi\b/i]) {
        assert.doesNotMatch(src, re);
      }
    });

    it("mainnet stays blocked: cluster, RPC and genesis guards all refuse it", async () => {
      const K = await import("../../src/lib/solana/cluster.ts");
      assert.equal(K.requireDevnetCluster(undefined), "devnet");
      assert.equal(K.requireDevnetCluster("devnet"), "devnet");
      for (const v of ["mainnet-beta", "mainnet", "testnet"]) assert.throws(() => K.requireDevnetCluster(v), /devnet only/);
      assert.throws(() => K.assertNotMainnetRpc("https://api.mainnet-beta.solana.com"), /Mainnet RPC refused/);
      assert.equal(K.assertNotMainnetRpc("https://api.devnet.solana.com"), "https://api.devnet.solana.com");
      assert.throws(() => K.assertDevnetGenesis(K.MAINNET_GENESIS), /mainnet/);
      assert.doesNotThrow(() => K.assertDevnetGenesis(K.DEVNET_GENESIS));
    });
  });

  describe("groups, invites and rate limits (NDU-17/22)", () => {
    it("invites are single-use, expire, and only members can mint them", async () => {
      const head = newUser();
      const g = await S.createGroup(sql, kek, head, "community", "Kalihi Valley Tools");
      const row = (await sql<{ name_enc: string }>`select name_enc from property_groups where id = ${g.id}`)[0];
      assert.ok(!row.name_enc.includes("Kalihi"), "group names are stored wrapped");
      await rejectsWith(S.createInvite(sql, newUser(), g.id), 404);

      const inv = await S.createInvite(sql, head, g.id);
      const hours = (Date.parse(inv.expiresAt) - Date.now()) / 3600_000;
      assert.ok(Math.abs(hours - PROPERTY.inviteHours) < 0.1);
      const stored = await sql<{ n: number }>`select count(*)::int as n from property_group_invites where token_hash = ${inv.code}`;
      assert.equal(stored[0].n, 0, "invite codes are stored hashed");

      await sql`update property_group_invites set expires_at = now() - interval '1 minute' where group_id = ${g.id}`;
      await rejectsWith(S.joinGroup(sql, kek, newUser(), inv.code), 404, /expired/);

      const inv2 = await S.createInvite(sql, head, g.id);
      const joiner = newUser();
      const joined = await S.joinGroup(sql, kek, joiner, inv2.code);
      assert.equal(joined.role, "member");
      assert.equal(joined.name, "Kalihi Valley Tools");
      assert.equal(joined.members, 2);
      await rejectsWith(S.joinGroup(sql, kek, newUser(), inv2.code), 404);
      await rejectsWith(S.joinGroup(sql, kek, newUser(), "short"), 400);
    });

    it("rate-limits group creation per user per day", async () => {
      const u = newUser();
      for (let i = 0; i < 5; i += 1) await S.createGroup(sql, kek, u, "family", `G${i}`);
      await rejectsWith(S.createGroup(sql, kek, u, "family", "G6"), 429, /Daily limit/);
      // another user is unaffected
      await S.createGroup(sql, kek, newUser(), "family", "fine");
    });
  });
});
