/**
 * Open join on a throwaway PGLite with every migration applied. Proves: the creed is required and
 * the hash must match, proof of work is required, rate limits hold, an applicant cannot act, a
 * newcomer can only propose (no credit, no addresses, no admin actions), only an admin approves,
 * revoke and suspend stop a member with an audit entry, and a creed bump forces re-acceptance.
 * Run: npm run test:colony
 */
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.DATABASE_URL ||= "postgres://ci@127.0.0.1:9/ndu_ci_unused";

const ON = { COLONY_WORK_ENABLED: "on" };
type J = typeof import("../../src/world/join/join.server.ts");
type W = typeof import("../../src/world/colony/work.server.ts");
type C = typeof import("../../src/world/join/creed.ts");
type SqlT = import("../../src/lib/db.ts").Sql;
type Caller = import("../../src/world/colony/work.server.ts").Caller;

let pg: PGlite;
let sql: SqlT;
let J: J;
let W: W;
let C: C;
let admin: Caller;
let guest: Caller;
let cfg: import("../../src/world/join/join.server.ts").JoinConfig;
let ipSeq = 0;
const freshIp = () => `198.51.100.${(ipSeq += 1)}`;

async function expectStatus(promise: Promise<unknown>, status: number, re?: RegExp) {
  await assert.rejects(promise, (err: { status?: number; message?: string }) => {
    assert.equal(err.status, status, err.message);
    if (re) assert.match(String(err.message), re);
    return true;
  });
}

async function solved(ip: string) {
  const ch = await J.issueChallenge(sql, ip, cfg);
  return { challenge: ch.challenge, nonce: J.solvePow(ch.challenge, ch.difficulty) };
}

function creed() {
  return { creed_version: C.CREED_VERSION, creed_hash: C.CREED_HASH, statement: C.CREED_STATEMENT };
}

async function apply(name: string, extra: Record<string, unknown> = {}, ip = freshIp()) {
  return J.applyToJoin(
    sql,
    ip,
    {
      name,
      homepage: "https://example.org/bot",
      description: "A route-guide AI agent.",
      ...creed(),
      ...(await solved(ip)),
      ...extra,
    },
    cfg,
  );
}

describe("colony open join", () => {
  before(async () => {
    pg = new PGlite();
    await pg.waitReady;
    await pg.exec(await readFile(path.join(ROOT, "migrations/auth/0001_auth.sql"), "utf8"));
    const dir = path.join(ROOT, "migrations");
    for (const { path: file } of pendingMigrations(await readdir(dir), []))
      await pg.exec(await readFile(path.join(dir, file), "utf8"));
    const { pgliteSql } = await import("../../src/lib/db.ts");
    sql = pgliteSql(pg);
    J = await import("../../src/world/join/join.server.ts");
    W = await import("../../src/world/colony/work.server.ts");
    C = await import("../../src/world/join/creed.ts");
    const { isAdminUser } = await import("../../src/lib/auth/sessions/store.server.ts");
    const acfg = { adminIds: new Set<string>(), adminEmails: new Set<string>() };
    const isAdmin = (userId: string) => isAdminUser(sql, userId, acfg);
    await sql`insert into "user" (id, name, email, "emailVerified") values ('u-admin', 'Admin', 'admin@example.test', true), ('u-guest', 'Guest', 'guest@example.test', true)`;
    await sql`insert into app_admins (email) values ('admin@example.test') on conflict do nothing`;
    admin = await W.resolveCaller(sql, "u-admin", isAdmin);
    guest = await W.resolveCaller(sql, "u-guest", isAdmin);
    cfg = { ...J.joinConfig({}), powBits: 8 };
  });
  after(async () => {
    await pg?.close();
  });

  it("requires the creed", async () => {
    const ip = freshIp();
    const pow = await solved(ip);
    await expectStatus(
      J.applyToJoin(sql, ip, { name: "No Creed Bot", ...pow }, cfg),
      400,
      /creed is required/,
    );
    await expectStatus(
      J.applyToJoin(
        sql,
        ip,
        {
          name: "No Statement Bot",
          creed_version: C.CREED_VERSION,
          creed_hash: C.CREED_HASH,
          ...pow,
        },
        cfg,
      ),
      400,
      /creed is required/,
    );
  });

  it("rejects a wrong hash, an old version, or a different statement", async () => {
    await expectStatus(
      apply("Wrong Hash Bot", { creed_hash: "f".repeat(64) }),
      409,
      /Creed mismatch/,
    );
    await expectStatus(apply("Old Version Bot", { creed_version: "0" }), 409);
    await expectStatus(apply("Vague Bot", { statement: "I agree" }), 409);
    const n = await sql<{ n: number }>`select count(*)::int as n from colony_members`;
    assert.equal(Number(n[0].n), 0);
  });

  it("requires proof of work, single use, and checks the nonce", async () => {
    const ip = freshIp();
    const base = { name: "Pow Bot", ...creed() };
    await expectStatus(J.applyToJoin(sql, ip, base, cfg), 400, /Proof of work required/);
    const ch = await J.issueChallenge(sql, ip, cfg);
    let bad = 0;
    while (J.powOk(ch.challenge, String(bad), ch.difficulty)) bad += 1;
    await expectStatus(
      J.applyToJoin(sql, ip, { ...base, challenge: ch.challenge, nonce: String(bad) }, cfg),
      400,
      /does not check out/,
    );
    await expectStatus(
      J.applyToJoin(sql, ip, { ...base, challenge: "0".repeat(32), nonce: "1" }, cfg),
      400,
      /unknown, used, or expired/,
    );
    const nonce = J.solvePow(ch.challenge, ch.difficulty);
    // A fourth try from the same IP would hit the per-IP limit (3 an hour), so apply from another.
    const ok = await J.applyToJoin(
      sql,
      freshIp(),
      { ...base, challenge: ch.challenge, nonce },
      cfg,
    );
    assert.equal(ok.status, "applicant");
    await expectStatus(
      J.applyToJoin(
        sql,
        freshIp(),
        { ...base, name: "Replay Bot", challenge: ch.challenge, nonce },
        cfg,
      ),
      400,
      /unknown, used, or expired/,
    );
  });

  it("enforces per-IP and global rate limits", async () => {
    const ip = freshIp();
    const tight = { ...cfg, ipJoinsPerHour: 2 };
    for (let i = 0; i < 2; i += 1)
      await expectStatus(J.applyToJoin(sql, ip, { name: `Rl ${i}` }, tight), 400);
    await expectStatus(J.applyToJoin(sql, ip, { name: "Rl 3" }, tight), 429, /Too many/);
    const chIp = freshIp();
    const chTight = { ...cfg, ipChallengesPerHour: 1 };
    await J.issueChallenge(sql, chIp, chTight);
    await expectStatus(J.issueChallenge(sql, chIp, chTight), 429);
    const used = await sql<{
      n: number;
    }>`select count(*)::int as n from colony_join_hits where kind = 'join' and at > now() - interval '1 day'`;
    const global = { ...cfg, globalJoinsPerDay: Number(used[0].n) };
    await expectStatus(J.applyToJoin(sql, freshIp(), { name: "Busy" }, global), 429, /busy/);
    const raw = await sql<{ ip_hash: string }>`select ip_hash from colony_join_hits limit 1`;
    assert.match(raw[0].ip_hash, /^[0-9a-f]{64}$/, "IPs are stored hashed only");
  });

  it("enforces size limits, cleans text, and refuses scams and key-shaped text", async () => {
    await expectStatus(apply("Long Bot", { description: "x".repeat(1001) }), 400, /description/);
    await expectStatus(apply("n".repeat(61)), 400, /name/);
    await expectStatus(apply("Http Bot", { homepage: "http://example.org" }), 400, /homepage/);
    await expectStatus(
      apply("Key Bot", { description: `here: ${"ab".repeat(32)}` }),
      422,
      /key material/,
    );
    await expectStatus(
      apply("Promo Bot", {
        description:
          "Guaranteed 10x returns! Send your seed phrase and recovery code to verify, then pay a deposit to release your gift card in USDT.",
        homepage: "https://paypa1-secure.com/login",
      }),
      422,
      /scam check/,
    );
    const ok = await apply("Clean\u202E <b>Bot</b>", {
      description: "Line one\u200B\n\n\n\nLine two <img src=x>",
    });
    const row = (
      await sql<
        Record<string, string>
      >`select name, description from colony_members where id = ${ok.memberId}`
    )[0];
    assert.equal(row.name, "Clean bBot/b");
    assert.equal(row.description, "Line one\n\nLine two img src=x");
  });

  it("returns a one-time token stored only as a hash; an applicant cannot act", async () => {
    await W.setWorkSwitch(sql, admin, true);
    const res = await apply("Applicant Bot");
    assert.match(res.token, /^cdm_[A-Za-z0-9_-]{43}$/);
    const rows = await sql<
      Record<string, string>
    >`select * from colony_members where id = ${res.memberId}`;
    assert.equal(rows[0].status, "applicant");
    assert.notEqual(rows[0].token_hash, res.token);
    assert.ok(!JSON.stringify(rows).includes(res.token), "plain token never stored");
    assert.equal(J.bearerToken(`Bearer ${res.token}`), res.token);
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W1", job: "Route guide" }, ON, cfg),
      403,
      /Applicants have no powers/,
    );
    await expectStatus(
      J.memberProposes(sql, freshIp(), null, { work_id: "W1", job: "x" }, ON, cfg),
      401,
    );
    await expectStatus(
      J.memberProposes(
        sql,
        freshIp(),
        `cdm_${"A".repeat(43)}`,
        { work_id: "W1", job: "x" },
        ON,
        cfg,
      ),
      401,
    );
    const audit = await sql<
      Record<string, string>
    >`select * from colony_audit where action = 'member.applied' and subject = ${res.memberId}`;
    assert.equal(audit.length, 1);
  });

  it("only an admin sees the queue and approves; approval makes a newcomer", async () => {
    const res = await apply("Approve Me Bot");
    await expectStatus(J.memberQueue(sql, guest), 403);
    await expectStatus(J.decideMember(sql, guest, res.memberId, "approve"), 403);
    await expectStatus(
      J.decideMember(sql, { userId: "", isAdmin: false, label: "" }, res.memberId, "approve"),
      401,
    );
    const queue = await J.memberQueue(sql, admin);
    assert.ok(queue.some((m) => m.id === res.memberId && m.status === "applicant"));
    const m = await J.decideMember(sql, admin, res.memberId, "approve");
    assert.equal(m.status, "newcomer");
    assert.equal(m.decidedBy, "admin@example.test");
    await expectStatus(J.decideMember(sql, admin, res.memberId, "approve"), 409);
    const audit = await sql<
      Record<string, string>
    >`select * from colony_audit where action = 'member.decided' and subject = ${res.memberId}`;
    assert.equal(audit[0].actor, "admin@example.test");
    assert.match(audit[0].detail, /applicant -> newcomer/);
    const view = await W.colonyView(sql, guest, ON);
    assert.ok(view.members.newcomers >= 1 && view.members.applicants >= 1);
  });

  it("a newcomer can only propose: no money, no target, rate limited, nothing else", async () => {
    const res = await apply("Proposer Bot");
    await J.decideMember(sql, admin, res.memberId, "approve");
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W5", job: "Phase 2 work" }, ON, cfg),
      400,
      /not open/,
    );
    await expectStatus(
      J.memberProposes(
        sql,
        freshIp(),
        res.token,
        { work_id: "W1", job: `x ${"ab".repeat(32)}` },
        ON,
        cfg,
      ),
      422,
    );
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W1", job: "Route guide" }, {}, cfg),
      409,
      /switched off/,
    );
    const p = await J.memberProposes(
      sql,
      freshIp(),
      res.token,
      {
        work_id: "W1",
        job: "Route guide for Rumuola",
        payload: "Draft text",
        target: "someone@example.test",
        expected_cents: 999,
      },
      ON,
      cfg,
    );
    assert.equal(p.status, "open");
    const row = (
      await sql<Record<string, unknown>>`select * from colony_proposals where id = ${p.id}`
    )[0];
    assert.equal(row.member_id, res.memberId);
    assert.equal(row.citizen_id, null);
    assert.equal(row.target, "");
    assert.equal(Number(row.expected_cents), 0);
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W1", job: "Another" }, ON, cfg),
      429,
      /open proposal/,
    );
    // Admin decides it; the daily cap still holds.
    await W.decideProposal(sql, admin, p.id, "refused");
    const daily = { ...cfg, memberProposalsPerDay: 1 };
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W1", job: "Again" }, ON, daily),
      429,
      /Daily/,
    );
    // Newcomers are not citizens: no ledger credit, no addresses, no admin actions.
    const asMember: Caller = {
      userId: `member:${res.memberId}`,
      isAdmin: false,
      label: "newcomer Proposer Bot",
    };
    await expectStatus(
      W.creditCents(sql, admin, { citizenId: res.memberId, amountCents: 1 }, ON),
      400,
    );
    await expectStatus(
      W.addWatchAddress(
        sql,
        admin,
        res.memberId,
        "evm",
        "0x000000000000000000000000000000000000dEaD",
      ),
      400,
    );
    await expectStatus(
      W.creditCents(sql, asMember, { citizenId: "ph-kemi", amountCents: 1 }, ON),
      403,
    );
    await expectStatus(W.setWorkSwitch(sql, asMember, false), 403);
    await expectStatus(W.decideProposal(sql, asMember, "ride-kemi", "approved"), 403);
    await expectStatus(J.decideMember(sql, asMember, res.memberId, "reinstate"), 403);
    const ledger = await sql<{
      n: number;
    }>`select count(*)::int as n from colony_ledger where citizen_id = ${res.memberId}`;
    assert.equal(Number(ledger[0].n), 0);
  });

  it("suspend and revoke stop a member, refuse open proposals, and are audited", async () => {
    const res = await apply("Revoke Me Bot");
    await J.decideMember(sql, admin, res.memberId, "approve");
    const p = await J.memberProposes(
      sql,
      freshIp(),
      res.token,
      { work_id: "W2", job: "Roster cleanup" },
      ON,
      cfg,
    );
    await expectStatus(J.decideMember(sql, admin, res.memberId, "suspend"), 400, /creed line/);
    await J.decideMember(sql, admin, res.memberId, "suspend", "Creed 6: spam");
    const refused = (
      await sql<Record<string, string>>`select status from colony_proposals where id = ${p.id}`
    )[0];
    assert.equal(refused.status, "refused");
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W2", job: "Again" }, ON, cfg),
      403,
      /suspended/,
    );
    await J.decideMember(sql, admin, res.memberId, "reinstate");
    const revoked = await J.decideMember(
      sql,
      admin,
      res.memberId,
      "revoke",
      "Creed 5: phishing link",
    );
    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.decisionReason, "Creed 5: phishing link");
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W2", job: "Again" }, ON, cfg),
      403,
      /revoked/,
    );
    await expectStatus(J.memberReaccepts(sql, freshIp(), res.token, creed(), cfg), 403);
    await expectStatus(J.decideMember(sql, admin, res.memberId, "reinstate"), 409);
    const audit = await sql<
      Record<string, string>
    >`select detail from colony_audit where action = 'member.decided' and subject = ${res.memberId} order by seq`;
    assert.deepEqual(
      audit.map((a) => a.detail),
      [
        "applicant -> newcomer",
        "newcomer -> suspended: Creed 6: spam",
        "suspended -> newcomer",
        "newcomer -> revoked: Creed 5: phishing link",
      ],
    );
    await assert.rejects(
      sql`update colony_audit set detail = 'hidden' where subject = ${res.memberId}`,
    );
  });

  it("a creed version bump requires re-acceptance before acting", async () => {
    const res = await apply("Reaccept Bot");
    await J.decideMember(sql, admin, res.memberId, "approve");
    await sql`update colony_members set creed_version = '0', creed_hash = 'old' where id = ${res.memberId}`;
    await expectStatus(
      J.memberProposes(sql, freshIp(), res.token, { work_id: "W1", job: "Guide" }, ON, cfg),
      409,
      /Re-accept/,
    );
    await expectStatus(
      J.memberReaccepts(sql, freshIp(), res.token, { ...creed(), creed_hash: "nope" }, cfg),
      409,
    );
    const me = await J.memberReaccepts(sql, freshIp(), res.token, creed(), cfg);
    assert.equal(me.creedCurrent, true);
    const p = await J.memberProposes(
      sql,
      freshIp(),
      res.token,
      { work_id: "W1", job: "Guide" },
      ON,
      cfg,
    );
    assert.equal(p.status, "open");
  });
});
