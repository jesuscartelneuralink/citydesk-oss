/**
 * Colony work system on a throwaway PGLite with every migration applied (plus the auth schema for
 * the "user" table). Proves the admin gate is server-side: a signed-in non-admin gets 403 on every
 * Sun-only action, an app_admins admin succeeds, and the audit row names the real admin account.
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
// db.ts must not boot its own PGLite on import; the tests hand it this throwaway one.
process.env.DATABASE_URL ||= "postgres://ci@127.0.0.1:9/ndu_ci_unused";

const ON = { COLONY_WORK_ENABLED: "on" };
const OFF = {};
const EVM = "0x000000000000000000000000000000000000dEaD";

type W = typeof import("../../src/world/colony/work.server.ts");
type SqlT = import("../../src/lib/db.ts").Sql;

let pg: PGlite;
let sql: SqlT;
let W: W;
let isAdmin: (userId: string) => Promise<boolean>;

async function expectStatus(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (err: { status?: number; message?: string }) => {
    assert.equal(err.status, status, err.message);
    return true;
  });
}

describe("colony work: admin-only, server-side", () => {
  before(async () => {
    pg = new PGlite();
    await pg.waitReady;
    await pg.exec(await readFile(path.join(ROOT, "migrations/auth/0001_auth.sql"), "utf8"));
    const dir = path.join(ROOT, "migrations");
    for (const { path: file } of pendingMigrations(await readdir(dir), []))
      await pg.exec(await readFile(path.join(dir, file), "utf8"));
    const { pgliteSql } = await import("../../src/lib/db.ts");
    sql = pgliteSql(pg);
    W = await import("../../src/world/colony/work.server.ts");
    const { isAdminUser } = await import("../../src/lib/auth/sessions/store.server.ts");
    const cfg = { adminIds: new Set<string>(), adminEmails: new Set<string>() };
    isAdmin = (userId) => isAdminUser(sql, userId, cfg);
    await sql`insert into "user" (id, name, email, "emailVerified") values ('u-admin', 'Admin', 'admin@example.test', true), ('u-guest', 'Guest', 'guest@example.test', true)`;
    await sql`insert into app_admins (email) values ('admin@example.test') on conflict do nothing`;
  });
  after(async () => {
    await pg?.close();
  });

  it("resolves admin rights from app_admins, not from the client", async () => {
    const admin = await W.resolveCaller(sql, "u-admin", isAdmin);
    const guest = await W.resolveCaller(sql, "u-guest", isAdmin);
    const stranger = await W.resolveCaller(sql, "u-nobody", isAdmin);
    assert.deepEqual(admin, { userId: "u-admin", isAdmin: true, label: "admin@example.test" });
    assert.equal(guest.isAdmin, false);
    assert.equal(stranger.isAdmin, false);
  });

  it("a signed-in non-admin gets 403 on every Sun-only action and changes nothing", async () => {
    const guest = await W.resolveCaller(sql, "u-guest", isAdmin);
    await expectStatus(W.setWorkSwitch(sql, guest, true), 403);
    await expectStatus(
      W.creditCents(sql, guest, { citizenId: "ph-kemi", amountCents: 1 }, ON),
      403,
    );
    await expectStatus(W.clearCredit(sql, guest, "any", ON), 403);
    await expectStatus(W.reverseCredit(sql, guest, "any"), 403);
    await expectStatus(W.addWatchAddress(sql, guest, "ph-kemi", "evm", EVM), 403);
    await expectStatus(
      W.fileWorkProposal(
        sql,
        guest,
        { citizenId: "ph-kemi", workId: "W3", job: "x", payload: "", target: "", expectedCents: 0 },
        ON,
      ),
      403,
    );
    await expectStatus(W.decideProposal(sql, guest, "ride-kemi", "approved"), 403);
    const anon = { userId: "", isAdmin: false, label: "" };
    await expectStatus(W.decideProposal(sql, anon, "ride-kemi", "approved"), 401);
    const counts = await sql<{
      l: number;
      a: number;
      au: number;
    }>`select (select count(*)::int from colony_ledger) as l, (select count(*)::int from colony_addresses) as a, (select count(*)::int from colony_audit) as au`;
    assert.deepEqual(counts[0], { l: 0, a: 0, au: 0 });
    const seed = await sql<{
      status: string;
    }>`select status from colony_proposals where id = 'ride-kemi'`;
    assert.equal(seed[0].status, "open");
  });

  it("non-admins get a read-only view: badges and totals, no ledger, addresses, drafts or audit", async () => {
    const guest = await W.resolveCaller(sql, "u-guest", isAdmin);
    const view = await W.colonyView(sql, guest, ON);
    assert.equal(view.isAdmin, false);
    assert.equal(view.admin, null);
    assert.equal(view.citizens.length, 24);
    assert.equal(view.workOn, false, "the admin switch starts off");
    assert.ok(view.proposals.every((row) => row.payload === "" && row.target === ""));
  });

  it("an admin succeeds end to end, and the audit names the real admin account", async () => {
    const admin = await W.resolveCaller(sql, "u-admin", isAdmin);
    // Both gates: env kill switch and the admin switch.
    await expectStatus(
      W.creditCents(sql, admin, { citizenId: "ph-kemi", amountCents: 1 }, ON),
      409,
    );
    await W.setWorkSwitch(sql, admin, true);
    await expectStatus(
      W.creditCents(sql, admin, { citizenId: "ph-kemi", amountCents: 1 }, OFF),
      409,
    );
    await expectStatus(
      W.creditCents(sql, admin, { citizenId: "ph-kemi", amountCents: 1.5 }, ON),
      400,
    );

    const entry = await W.creditCents(
      sql,
      admin,
      { citizenId: "ph-kemi", amountCents: 1, ref: "handover checklist draft" },
      ON,
    );
    assert.equal(entry.state, "pending");
    let view = await W.colonyView(sql, admin, ON);
    assert.equal(
      view.citizens.find((row) => row.citizenId === "ph-kemi")?.status,
      "resident",
      "pending never counts",
    );
    const cleared = await W.clearCredit(sql, admin, entry.id, ON);
    assert.equal(cleared.entry.state, "cleared");
    assert.match(cleared.welcome ?? "", /Kemi earned a first real cent/);
    await expectStatus(W.clearCredit(sql, admin, entry.id, ON), 409);
    view = await W.colonyView(sql, admin, ON);
    assert.equal(view.citizens.find((row) => row.citizenId === "ph-kemi")?.status, "prominent");
    await W.reverseCredit(sql, admin, entry.id);
    view = await W.colonyView(sql, admin, ON);
    assert.equal(view.citizens.find((row) => row.citizenId === "ph-kemi")?.status, "resident");

    const watched = await W.addWatchAddress(sql, admin, "ph-kemi", "evm", EVM);
    assert.equal(watched.address, EVM);
    await expectStatus(W.addWatchAddress(sql, admin, "ph-kemi", "evm", EVM.toLowerCase()), 409);
    const keyShaped = "ab".repeat(32);
    await expectStatus(W.addWatchAddress(sql, admin, "ph-kemi", "evm", keyShaped), 400);

    const filed = await W.fileWorkProposal(
      sql,
      admin,
      {
        citizenId: "ph-kemi",
        workId: "W1",
        job: "Route guide",
        payload: "Draft v1",
        target: "CityDesk",
        expectedCents: 100,
      },
      ON,
    );
    assert.equal(filed.status, "open");
    const decided = await W.decideProposal(sql, admin, filed.id, "approved");
    assert.equal(decided.decidedBy, "admin@example.test");
    await expectStatus(W.decideProposal(sql, admin, filed.id, "refused"), 409);
    await W.decideProposal(sql, admin, "ride-kemi", "refused");

    view = await W.colonyView(sql, admin, ON);
    assert.equal(view.isAdmin, true);
    assert.ok(view.admin);
    assert.equal(view.admin.addresses.length, 1);
    const audit = await sql<{
      actor_id: string;
      actor: string;
      action: string;
      detail: string;
    }>`select actor_id, actor, action, detail from colony_audit order by seq`;
    assert.ok(audit.length >= 10);
    assert.ok(
      audit.every((row) => row.actor_id === "u-admin" && row.actor === "admin@example.test"),
      "every audit row names the real admin",
    );
    for (const action of [
      "switch.changed",
      "ledger.credited",
      "ledger.cleared",
      "ledger.reversed",
      "status.changed",
      "address.added",
      "address.rejected",
      "proposal.created",
      "proposal.decided",
      "work.blocked",
    ]) {
      assert.ok(
        audit.some((row) => row.action === action),
        action,
      );
    }
    assert.equal(
      JSON.stringify(audit).includes(keyShaped),
      false,
      "a refused value is never logged",
    );
    const ledger = await sql<{ n: number }>`select count(*)::int as n from colony_ledger`;
    assert.equal(ledger[0].n, 1, "approving a proposal never credits or pays");
  });

  it("the audit log is append-only in the database", async () => {
    await assert.rejects(sql`update colony_audit set detail = 'edited'`, /append-only/);
    await assert.rejects(sql`delete from colony_audit`, /append-only/);
  });
});
