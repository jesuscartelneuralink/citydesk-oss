/**
 * Colony work system, server side. Every Sun-only action (credit, clear, reverse, add a watched
 * address, file/approve/refuse a proposal, flip the work switch) requires a logged-in ADMIN, checked
 * here on the server. The audit row records the real admin account. Nothing here signs, sends,
 * spends, transfers, or withdraws, and no key material is ever accepted or stored.
 *
 * Pure functions over `Sql` so they run on Postgres and on PGLite in tests. The server functions
 * that wire them to the login live in work.functions.ts.
 */
import type { Sql } from "@/lib/db";
import { checkAddress, isChain, type Chain, type WatchAddress } from "./addresses.ts";
import type { AuditAction, AuditRow } from "./audit.ts";
import { citizensFrom, isCitizen, statusFor, welcomeLine, type Citizen } from "./citizens.ts";
import {
  canMove,
  emptyTotals,
  SOURCES,
  validCents,
  type LedgerEntry,
  type LedgerSource,
  type LedgerState,
  type LedgerTotals,
} from "./ledger.ts";
import { checkWorkProposal, type Proposal, type WorkProposalInput } from "./proposals.ts";
import { workEffective, workEnvAllowed } from "./work.ts";

export class ColonyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Who is calling. `isAdmin` must come from the server-side admin check, never from the client. */
export type Caller = { userId: string; isAdmin: boolean; label: string };

/** Resolve the caller from the verified session user id, using the repo's admin check. */
export async function resolveCaller(
  sql: Sql,
  userId: string,
  isAdmin: (userId: string) => Promise<boolean>,
): Promise<Caller> {
  const admin = userId ? await isAdmin(userId).catch(() => false) : false;
  let label = userId;
  try {
    const rows = await sql<{ email: string | null }>`select email from "user" where id = ${userId}`;
    if (rows[0]?.email) label = rows[0].email;
  } catch {
    /* no "user" table on this database: keep the id */
  }
  return { userId, isAdmin: admin, label };
}

export function requireAdmin(caller: Caller): void {
  if (!caller.userId) throw new ColonyError("Sign in first.", 401);
  if (!caller.isAdmin) throw new ColonyError("Admins only.", 403);
}

export async function audit(
  sql: Sql,
  caller: Caller,
  action: AuditAction,
  subject: string,
  detail = "",
): Promise<void> {
  await sql`insert into colony_audit (actor_id, actor, action, subject, detail) values (${caller.userId}, ${caller.label.slice(0, 200)}, ${action}, ${subject.slice(0, 120)}, ${detail.slice(0, 500)})`;
}

const iso = (value: unknown): string => new Date(value as string).toISOString();
const isoOrNull = (value: unknown): string | null => (value ? iso(value) : null);

async function adminSwitchOn(sql: Sql): Promise<boolean> {
  const rows = await sql<{
    value: string;
  }>`select value from colony_settings where key = 'work_switch'`;
  return rows[0]?.value === "on";
}

export async function workOn(sql: Sql, env?: Record<string, string | undefined>): Promise<boolean> {
  return workEffective(workEnvAllowed(env), await adminSwitchOn(sql));
}

async function totalsByCitizen(sql: Sql): Promise<Map<string, LedgerTotals>> {
  const rows = await sql<{ citizen_id: string; state: LedgerState; cents: number }>`
    select citizen_id, state, coalesce(sum(amount_cents), 0)::int as cents from colony_ledger group by citizen_id, state`;
  const map = new Map<string, LedgerTotals>();
  for (const row of rows) {
    const totals = map.get(row.citizen_id) ?? emptyTotals();
    totals[row.state] += Number(row.cents);
    map.set(row.citizen_id, totals);
  }
  return map;
}

async function clearedOf(sql: Sql, citizenId: string): Promise<number> {
  const rows = await sql<{
    cents: number;
  }>`select coalesce(sum(amount_cents), 0)::int as cents from colony_ledger where citizen_id = ${citizenId} and state = 'cleared'`;
  return Number(rows[0]?.cents ?? 0);
}

function toEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    id: String(row.id),
    citizenId: String(row.citizen_id),
    jobId: String(row.job_id),
    source: row.source as LedgerSource,
    ref: String(row.ref ?? ""),
    amountCents: Number(row.amount_cents),
    state: row.state as LedgerState,
    createdAt: iso(row.created_at),
    changedAt: iso(row.changed_at),
  };
}

function toProposal(row: Record<string, unknown>): Proposal {
  return {
    id: String(row.id),
    bot: String(row.bot),
    city: String(row.city),
    job: String(row.job),
    price: String(row.price),
    status: row.status as Proposal["status"],
    kind: row.kind as Proposal["kind"],
    citizenId: (row.citizen_id as string | null) ?? null,
    workId: (row.work_id as string | null) ?? null,
    payload: String(row.payload ?? ""),
    target: String(row.target ?? ""),
    expectedCents: Number(row.expected_cents ?? 0),
    createdAt: isoOrNull(row.created_at),
    decidedAt: isoOrNull(row.decided_at),
    decidedBy: (row.decided_by as string | null) ?? null,
  };
}

/** Public view: badges and totals for everyone. Admins also get the ledger, addresses, proposals and audit. */
export type ColonyView = {
  isAdmin: boolean;
  workOn: boolean;
  envAllowed: boolean;
  adminSwitchOn: boolean;
  citizens: readonly Citizen[];
  proposals: readonly Proposal[];
  /** Open-join counts (public). Zero until migration 0024 is applied. */
  members: { applicants: number; newcomers: number };
  admin: null | {
    pending: readonly LedgerEntry[];
    addresses: readonly WatchAddress[];
    audit: readonly AuditRow[];
  };
};

async function memberCountsSafe(sql: Sql): Promise<{ applicants: number; newcomers: number }> {
  try {
    const rows = await sql<{
      status: string;
      n: number;
    }>`select status, count(*)::int as n from colony_members where status in ('applicant', 'newcomer') group by status`;
    const of = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return { applicants: of("applicant"), newcomers: of("newcomer") };
  } catch {
    return { applicants: 0, newcomers: 0 };
  }
}

export async function colonyView(
  sql: Sql,
  caller: Caller,
  env?: Record<string, string | undefined>,
): Promise<ColonyView> {
  const envAllowed = workEnvAllowed(env);
  const switchOn = await adminSwitchOn(sql);
  const citizens = citizensFrom(await totalsByCitizen(sql));
  const proposals = (
    await sql<
      Record<string, unknown>
    >`select * from colony_proposals order by created_at asc, id asc limit 200`
  ).map(toProposal);
  const base = {
    members: await memberCountsSafe(sql),
    isAdmin: caller.isAdmin,
    workOn: workEffective(envAllowed, switchOn),
    envAllowed,
    adminSwitchOn: switchOn,
    citizens,
  };
  if (!caller.isAdmin) {
    // Read-only for non-admins: badges, totals, and the job names. No drafts, targets or audit detail.
    return {
      ...base,
      proposals: proposals.map((row) => ({ ...row, payload: "", target: "", decidedBy: null })),
      admin: null,
    };
  }
  const pending = (
    await sql<
      Record<string, unknown>
    >`select * from colony_ledger where state = 'pending' order by created_at asc limit 200`
  ).map(toEntry);
  const addresses = (
    await sql<
      Record<string, unknown>
    >`select * from colony_addresses where active = true order by added_at asc limit 500`
  ).map((row) => ({
    id: String(row.id),
    citizenId: String(row.citizen_id),
    chain: row.chain as Chain,
    address: String(row.address),
    addedBy: String(row.added_by),
    addedAt: iso(row.added_at),
  }));
  const audit = (
    await sql<Record<string, unknown>>`select * from colony_audit order by seq desc limit 20`
  ).map((row) => ({
    seq: Number(row.seq),
    at: iso(row.at),
    actorId: String(row.actor_id),
    actor: String(row.actor),
    action: row.action as AuditAction,
    subject: String(row.subject),
    detail: String(row.detail ?? ""),
  }));
  return { ...base, proposals, admin: { pending, addresses, audit } };
}

export async function setWorkSwitch(
  sql: Sql,
  caller: Caller,
  on: boolean,
): Promise<{ adminSwitchOn: boolean }> {
  requireAdmin(caller);
  const value = on ? "on" : "off";
  await sql`insert into colony_settings (key, value, updated_by, updated_at) values ('work_switch', ${value}, ${caller.label}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, caller, "switch.changed", "work_switch", value);
  return { adminSwitchOn: on };
}

let seq = 0;
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(seq += 1).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export type CreditInput = {
  citizenId: string;
  jobId?: string;
  source?: LedgerSource;
  ref?: string;
  amountCents: number;
};

export async function creditCents(
  sql: Sql,
  caller: Caller,
  input: CreditInput,
  env?: Record<string, string | undefined>,
): Promise<LedgerEntry> {
  requireAdmin(caller);
  if (!isCitizen(input.citizenId)) throw new ColonyError("Unknown citizen.");
  if (!validCents(input.amountCents)) throw new ColonyError("Use whole cents above zero.");
  const source = input.source ?? "internal";
  if (!SOURCES.includes(source)) throw new ColonyError("Unknown source.");
  if (!(await workOn(sql, env))) {
    await audit(
      sql,
      caller,
      "work.blocked",
      input.citizenId,
      "credit refused: work is switched off",
    );
    throw new ColonyError("Colony work is switched off.", 409);
  }
  const id = newId("cr");
  const rows = await sql<Record<string, unknown>>`
    insert into colony_ledger (id, citizen_id, job_id, source, ref, amount_cents, state, created_by)
    values (${id}, ${input.citizenId}, ${(input.jobId ?? `w3-${id}`).slice(0, 80)}, ${source}, ${(input.ref ?? "").slice(0, 120)}, ${input.amountCents}, 'pending', ${caller.label})
    returning *`;
  await audit(
    sql,
    caller,
    "ledger.credited",
    input.citizenId,
    `${id} ${input.amountCents}c pending (${source})`,
  );
  return toEntry(rows[0]);
}

async function moveCredit(
  sql: Sql,
  caller: Caller,
  id: string,
  to: "cleared" | "reversed",
  env?: Record<string, string | undefined>,
): Promise<{ entry: LedgerEntry; welcome: string | null }> {
  requireAdmin(caller);
  const found = (
    await sql<
      Record<string, unknown>
    >`select * from colony_ledger where id = ${String(id).slice(0, 80)}`
  )[0];
  if (!found) throw new ColonyError("Unknown credit.", 404);
  const from = found.state as LedgerState;
  if (!canMove(from, to)) throw new ColonyError(`A ${from} credit cannot become ${to}.`, 409);
  if (to === "cleared" && !(await workOn(sql, env))) {
    await audit(
      sql,
      caller,
      "work.blocked",
      String(found.citizen_id),
      `clear refused: work is switched off (${id})`,
    );
    throw new ColonyError("Colony work is switched off.", 409);
  }
  const citizenId = String(found.citizen_id);
  const before = statusFor(await clearedOf(sql, citizenId));
  // Conditional update: a concurrent move of the same row loses cleanly.
  const rows = await sql<
    Record<string, unknown>
  >`update colony_ledger set state = ${to}, changed_at = now() where id = ${found.id as string} and state = ${from} returning *`;
  if (!rows.length) throw new ColonyError("That credit changed meanwhile. Reload.", 409);
  await audit(
    sql,
    caller,
    to === "cleared" ? "ledger.cleared" : "ledger.reversed",
    citizenId,
    `${id} ${Number(found.amount_cents)}c ${from} -> ${to}`,
  );
  const after = statusFor(await clearedOf(sql, citizenId));
  if (after !== before)
    await audit(sql, caller, "status.changed", citizenId, `${before} -> ${after}`);
  return {
    entry: toEntry(rows[0]),
    welcome: after === "prominent" && before !== "prominent" ? welcomeLine(citizenId) : null,
  };
}

export const clearCredit = (
  sql: Sql,
  caller: Caller,
  id: string,
  env?: Record<string, string | undefined>,
) => moveCredit(sql, caller, id, "cleared", env);
/** Reversal is always allowed (chargeback, reorg, rule break), even with work switched off. */
export const reverseCredit = (sql: Sql, caller: Caller, id: string) =>
  moveCredit(sql, caller, id, "reversed");

export async function addWatchAddress(
  sql: Sql,
  caller: Caller,
  citizenId: string,
  chain: unknown,
  raw: unknown,
): Promise<WatchAddress> {
  requireAdmin(caller);
  if (!isCitizen(citizenId)) throw new ColonyError("Unknown citizen.");
  if (!isChain(chain)) throw new ColonyError("Unknown chain.");
  const check = checkAddress(chain, String(raw ?? "").slice(0, 400));
  if (!check.ok) {
    // Never store or log the refused value itself.
    await audit(sql, caller, "address.rejected", citizenId, `${chain}: ${check.reason}`);
    throw new ColonyError(check.reason);
  }
  const dup =
    await sql`select 1 from colony_addresses where chain = ${chain} and lower(address) = lower(${check.address})`;
  if (dup.length) throw new ColonyError("That address is already on the list.", 409);
  const id = newId("addr");
  const rows = await sql<Record<string, unknown>>`
    insert into colony_addresses (id, citizen_id, chain, address, added_by) values (${id}, ${citizenId}, ${chain}, ${check.address}, ${caller.label}) returning *`;
  await audit(sql, caller, "address.added", citizenId, `${chain} ${check.address}`);
  const row = rows[0];
  return {
    id,
    citizenId,
    chain,
    address: check.address,
    addedBy: String(row.added_by),
    addedAt: iso(row.added_at),
  };
}

export async function fileWorkProposal(
  sql: Sql,
  caller: Caller,
  input: WorkProposalInput,
  env?: Record<string, string | undefined>,
): Promise<Proposal> {
  requireAdmin(caller);
  if (!(await workOn(sql, env))) {
    await audit(
      sql,
      caller,
      "work.blocked",
      String(input.citizenId).slice(0, 80),
      "proposal refused: work is switched off",
    );
    throw new ColonyError("Colony work is switched off.", 409);
  }
  const open = await sql<{
    n: number;
  }>`select count(*)::int as n from colony_proposals where citizen_id = ${input.citizenId} and status = 'open'`;
  const limit = statusFor(await clearedOf(sql, input.citizenId)) === "prominent" ? 2 : 1;
  const check = checkWorkProposal(input, Number(open[0]?.n ?? 0), limit);
  if (!check.ok) throw new ColonyError(check.reason);
  const id = newId(`work-${input.citizenId}`);
  const rows = await sql<Record<string, unknown>>`
    insert into colony_proposals (id, citizen_id, bot, city, job, price, kind, work_id, payload, target, expected_cents)
    values (${id}, ${input.citizenId}, ${check.bot}, ${check.city}, ${input.job.slice(0, 200)}, ${check.price}, ${check.kind}, ${input.workId}, ${input.payload.slice(0, 4000)}, ${input.target.slice(0, 200)}, ${input.expectedCents})
    returning *`;
  await audit(
    sql,
    caller,
    "proposal.created",
    input.citizenId,
    `${id} ${input.workId} ${input.expectedCents}c`,
  );
  return toProposal(rows[0]);
}

/** Approve or refuse. Admin only. A decided proposal cannot be re-decided. Approving never pays or signs. */
export async function decideProposal(
  sql: Sql,
  caller: Caller,
  id: string,
  status: unknown,
): Promise<Proposal> {
  requireAdmin(caller);
  if (status !== "approved" && status !== "refused")
    throw new ColonyError("Approve or refuse only.");
  const rows = await sql<Record<string, unknown>>`
    update colony_proposals set status = ${status}, decided_at = now(), decided_by = ${caller.label}
    where id = ${String(id).slice(0, 120)} and status = 'open' returning *`;
  if (!rows.length) throw new ColonyError("That proposal is not open.", 409);
  const row = toProposal(rows[0]);
  await audit(sql, caller, "proposal.decided", row.citizenId ?? row.bot, `${row.id} ${status}`);
  return row;
}
