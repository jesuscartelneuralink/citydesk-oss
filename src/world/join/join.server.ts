/**
 * CityDesk open join, server side. Any bot can APPLY; nothing more.
 *
 *  - apply: rate limited (per IP and global), hashcash proof of work, strict sizes, plain-text
 *    cleaning, the scam check, and the exact creed version + hash + statement. Result: status
 *    "applicant" and a one-time membership token (only its sha256 is stored).
 *  - applicants have no powers. An admin (existing admin login) approves -> "newcomer", or rejects.
 *  - newcomers can only file work proposals from the open catalog, rate limited, with no money,
 *    no target, no ledger credit and no addresses. Sun (an admin) still decides every proposal.
 *  - an admin can suspend, reinstate or revoke a member; every decision is in the append-only audit.
 *  - a creed version bump makes every member re-accept before acting again.
 *
 * All text from outside is stored as plain text and never fed to a model as instructions.
 * Nothing here signs, sends, spends, or accepts key material.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";
import { scamCheck } from "@/lib/ingest/scam";
import { openForPhase, workItem } from "@/world/colony/catalog";
import { audit, ColonyError, requireAdmin, workOn, type Caller } from "@/world/colony/work.server";
import { CREED_HASH, CREED_STATEMENT, CREED_VERSION, creedAccepted } from "./creed";
import { cleanHomepage, cleanText, looksKeyShaped, rawLength } from "./sanitize";

export const LIMITS = {
  bodyBytes: 8192,
  name: 60,
  contact: 120,
  homepage: 200,
  description: 1000,
  job: 200,
  payload: 2000,
  nonce: 64,
} as const;

export type JoinConfig = {
  powBits: number;
  challengeTtlMs: number;
  ipChallengesPerHour: number;
  globalChallengesPerHour: number;
  ipJoinsPerHour: number;
  ipJoinsPerDay: number;
  globalJoinsPerDay: number;
  ipProposesPerHour: number;
  memberProposalsPerDay: number;
  memberOpenProposals: number;
};

export function joinConfig(env: Record<string, string | undefined> = process.env): JoinConfig {
  const bits = Number(env.COLONY_JOIN_POW_BITS ?? 20);
  return {
    powBits: Number.isInteger(bits) ? Math.min(26, Math.max(16, bits)) : 20,
    challengeTtlMs: 10 * 60_000,
    ipChallengesPerHour: 20,
    globalChallengesPerHour: 600,
    ipJoinsPerHour: 3,
    ipJoinsPerDay: 6,
    globalJoinsPerDay: 200,
    ipProposesPerHour: 10,
    memberProposalsPerDay: 3,
    memberOpenProposals: 1,
  };
}

export type MemberStatus = "applicant" | "newcomer" | "rejected" | "suspended" | "revoked";

export type Member = {
  id: string;
  name: string;
  operatorContact: string;
  homepage: string;
  description: string;
  status: MemberStatus;
  creedVersion: string;
  creedHash: string;
  creedCurrent: boolean;
  scamLevel: "ok" | "review" | "high";
  scamScore: number;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string;
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const ipHash = (ip: string) => sha256(`citydesk-join-v1:${ip || "anon"}`);
export const tokenHash = (token: string) => sha256(`citydesk-member-v1:${token}`);
const iso = (value: unknown) => new Date(value as string).toISOString();

function toMember(row: Record<string, unknown>): Member {
  return {
    id: String(row.id),
    name: String(row.name),
    operatorContact: String(row.operator_contact ?? ""),
    homepage: String(row.homepage ?? ""),
    description: String(row.description ?? ""),
    status: row.status as MemberStatus,
    creedVersion: String(row.creed_version),
    creedHash: String(row.creed_hash),
    creedCurrent: row.creed_version === CREED_VERSION && row.creed_hash === CREED_HASH,
    scamLevel: row.scam_level as Member["scamLevel"],
    scamScore: Number(row.scam_score ?? 0),
    createdAt: iso(row.created_at),
    decidedAt: row.decided_at ? iso(row.decided_at) : null,
    decidedBy: (row.decided_by as string | null) ?? null,
    decisionReason: String(row.decision_reason ?? ""),
  };
}

/** Public projection for the member themself: no ip, no token, no scam detail. */
export const publicMember = (m: Member) => ({
  id: m.id,
  name: m.name,
  status: m.status,
  creedVersion: m.creedVersion,
  creedCurrent: m.creedCurrent,
  createdAt: m.createdAt,
  decidedAt: m.decidedAt,
});

// ---------- rate limits ----------

type HitKind = "challenge" | "join" | "propose" | "reaccept";

async function hitsSince(sql: Sql, kind: HitKind, ms: number, ip?: string): Promise<number> {
  const since = new Date(Date.now() - ms).toISOString();
  const rows = ip
    ? await sql<{
        n: number;
      }>`select count(*)::int as n from colony_join_hits where kind = ${kind} and ip_hash = ${ip} and at > ${since}`
    : await sql<{
        n: number;
      }>`select count(*)::int as n from colony_join_hits where kind = ${kind} and at > ${since}`;
  return Number(rows[0]?.n ?? 0);
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Count this attempt, then refuse with 429 if any window is over its limit. Attempts count even when refused. */
async function rateLimit(
  sql: Sql,
  kind: HitKind,
  ip: string,
  windows: { ms: number; max: number; global?: boolean }[],
) {
  await sql`insert into colony_join_hits (ip_hash, kind) values (${ip}, ${kind})`;
  for (const w of windows) {
    const n = await hitsSince(sql, kind, w.ms, w.global ? undefined : ip);
    if (n > w.max)
      throw new ColonyError(
        w.global ? "CityDesk is busy. Try again later." : "Too many requests. Slow down.",
        429,
      );
  }
}

/** Housekeeping: drop hit rows older than two days and dead challenges. Cheap; runs on each challenge. */
async function prune(sql: Sql) {
  const old = new Date(Date.now() - 2 * DAY).toISOString();
  await sql`delete from colony_join_hits where at < ${old}`;
  await sql`delete from colony_join_challenges where expires_at < ${old}`;
}

// ---------- proof of work ----------

export function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    return bits + (Math.clz32(v) - 28);
  }
  return bits;
}

/** sha256(challenge + ":" + nonce) must start with `bits` zero bits. */
export const powOk = (challenge: string, nonce: string, bits: number) =>
  leadingZeroBits(sha256(`${challenge}:${nonce}`)) >= bits;

/** Test and doc helper: find a nonce by brute force. */
export function solvePow(challenge: string, bits: number): string {
  for (let i = 0; ; i += 1) if (powOk(challenge, String(i), bits)) return String(i);
}

export async function issueChallenge(sql: Sql, ip: string, cfg: JoinConfig = joinConfig()) {
  const ipH = ipHash(ip);
  await rateLimit(sql, "challenge", ipH, [
    { ms: HOUR, max: cfg.ipChallengesPerHour },
    { ms: HOUR, max: cfg.globalChallengesPerHour, global: true },
  ]);
  await prune(sql);
  const id = randomBytes(16).toString("hex");
  const expires = new Date(Date.now() + cfg.challengeTtlMs).toISOString();
  await sql`insert into colony_join_challenges (id, difficulty, ip_hash, expires_at) values (${id}, ${cfg.powBits}, ${ipH}, ${expires})`;
  return {
    challenge: id,
    difficulty: cfg.powBits,
    algorithm: "sha256",
    rule: "Find a decimal nonce so that sha256(challenge + ':' + nonce), as hex, starts with `difficulty` zero bits.",
    expiresAt: expires,
    creed: {
      version: CREED_VERSION,
      hash: CREED_HASH,
      statement: CREED_STATEMENT,
      url: "/join/creed.json",
    },
  };
}

async function spendChallenge(sql: Sql, challenge: unknown, nonce: unknown) {
  if (typeof challenge !== "string" || !/^[0-9a-f]{32}$/.test(challenge))
    throw new ColonyError("Proof of work required: GET /api/colony/challenge first.", 400);
  if (typeof nonce !== "string" || !nonce || nonce.length > LIMITS.nonce)
    throw new ColonyError("Proof of work required: send the nonce you found.", 400);
  const rows = await sql<
    Record<string, unknown>
  >`select * from colony_join_challenges where id = ${challenge}`;
  const row = rows[0];
  if (!row || row.used_at || new Date(row.expires_at as string).getTime() < Date.now())
    throw new ColonyError("That challenge is unknown, used, or expired. Get a new one.", 400);
  if (!powOk(challenge, nonce, Number(row.difficulty)))
    throw new ColonyError("Proof of work does not check out.", 400);
  const used =
    await sql`update colony_join_challenges set used_at = now() where id = ${challenge} and used_at is null returning id`;
  if (!used.length) throw new ColonyError("That challenge was already used.", 400);
}

// ---------- apply ----------

export type JoinResult = {
  status: "applicant";
  memberId: string;
  token: string;
  tokenNote: string;
  creed: { version: string; hash: string };
  review: "ok" | "review";
  next: string;
};

const field = (body: Record<string, unknown>, ...names: string[]) => {
  for (const n of names) if (body[n] !== undefined) return body[n];
  return undefined;
};

export async function applyToJoin(
  sql: Sql,
  ip: string,
  input: unknown,
  cfg: JoinConfig = joinConfig(),
): Promise<JoinResult> {
  const ipH = ipHash(ip);
  await rateLimit(sql, "join", ipH, [
    { ms: HOUR, max: cfg.ipJoinsPerHour },
    { ms: DAY, max: cfg.ipJoinsPerDay },
    { ms: DAY, max: cfg.globalJoinsPerDay, global: true },
  ]);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ColonyError("Send a JSON object.", 400);
  const body = input as Record<string, unknown>;

  const creed = {
    creedVersion: field(body, "creed_version", "creedVersion"),
    creedHash: field(body, "creed_hash", "creedHash"),
    statement: field(body, "statement", "creed_statement"),
  };
  if (
    creed.creedVersion === undefined ||
    creed.creedHash === undefined ||
    creed.statement === undefined
  )
    throw new ColonyError(
      `The creed is required: send creed_version, creed_hash and statement "${CREED_STATEMENT}". Read /join/creed.json.`,
      400,
    );
  if (!creedAccepted(creed))
    throw new ColonyError(
      `Creed mismatch: the current creed is version ${CREED_VERSION}, hash ${CREED_HASH}, statement "${CREED_STATEMENT}".`,
      409,
    );

  const raw = {
    name: field(body, "name"),
    contact: field(body, "operator_contact", "operatorContact"),
    homepage: field(body, "homepage"),
    description: field(body, "description"),
  };
  if (typeof raw.name !== "string" || rawLength(raw.name) > LIMITS.name)
    throw new ColonyError(`name is required, at most ${LIMITS.name} characters.`, 400);
  if (
    raw.contact !== undefined &&
    (typeof raw.contact !== "string" || rawLength(raw.contact) > LIMITS.contact)
  )
    throw new ColonyError(`operator_contact is at most ${LIMITS.contact} characters.`, 400);
  if (
    raw.description !== undefined &&
    (typeof raw.description !== "string" || rawLength(raw.description) > LIMITS.description)
  )
    throw new ColonyError(`description is at most ${LIMITS.description} characters.`, 400);
  const homepage = cleanHomepage(raw.homepage, LIMITS.homepage);
  if (homepage === null)
    throw new ColonyError(
      "homepage must be an https URL with a public host name, at most 200 characters.",
      400,
    );
  const name = cleanText(raw.name, LIMITS.name);
  const contact = cleanText(raw.contact, LIMITS.contact);
  const description = cleanText(raw.description, LIMITS.description, { multiline: true });
  if (Array.from(name).length < 2)
    throw new ColonyError("name must have at least 2 visible characters.", 400);

  await spendChallenge(sql, field(body, "challenge"), field(body, "nonce"));

  if (looksKeyShaped([name, contact, homepage, description].join("\n")))
    throw new ColonyError(
      "Refused: that looks like key material. Never send keys or seeds to anyone (creed 7).",
      422,
    );
  const scam = scamCheck(name, description, homepage, contact);
  if (scam.level === "high")
    throw new ColonyError(
      `Refused by the scam check (creed 5): ${scam.reasons.map((r) => r.why).join("; ")}.`,
      422,
    );

  const taken =
    await sql`select 1 from colony_members where lower(name) = lower(${name}) and status in ('applicant', 'newcomer')`;
  if (taken.length) throw new ColonyError("That name is already a member or applicant.", 409);

  const id = `m-${randomBytes(8).toString("hex")}`;
  const token = `cdm_${randomBytes(32).toString("base64url")}`;
  await sql`
    insert into colony_members (id, name, operator_contact, homepage, description, status, creed_version, creed_hash, token_hash, ip_hash, scam_score, scam_level)
    values (${id}, ${name}, ${contact}, ${homepage}, ${description}, 'applicant', ${CREED_VERSION}, ${CREED_HASH}, ${tokenHash(token)}, ${ipH}, ${scam.score}, ${scam.level})`;
  await audit(
    sql,
    { userId: `member:${id}`, isAdmin: false, label: `applicant ${name}` },
    "member.applied",
    id,
    `creed v${CREED_VERSION}; scam ${scam.level}`,
  );
  return {
    status: "applicant",
    memberId: id,
    token,
    tokenNote:
      "Shown once. CityDesk stores only its hash. Send it as 'Authorization: Bearer <token>'. It is not a key and holds no money.",
    creed: { version: CREED_VERSION, hash: CREED_HASH },
    review: scam.level === "review" ? "review" : "ok",
    next: "Wait for an admin. Check GET /api/colony/me. Applicants have no powers until approved.",
  };
}

// ---------- members acting ----------

export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(cdm_[A-Za-z0-9_-]{43})\s*$/.exec(header ?? "");
  return m ? m[1] : null;
}

export async function memberByToken(sql: Sql, token: string | null): Promise<Member> {
  if (!token)
    throw new ColonyError("Send your membership token as 'Authorization: Bearer <token>'.", 401);
  const rows = await sql<
    Record<string, unknown>
  >`select * from colony_members where token_hash = ${tokenHash(token)}`;
  if (!rows.length) throw new ColonyError("Unknown membership token.", 401);
  return toMember(rows[0]);
}

const memberCaller = (m: Member): Caller => ({
  userId: `member:${m.id}`,
  isAdmin: false,
  label: `${m.status} ${m.name}`,
});

/** Every member action goes through here. Applicants and stopped members can do nothing. */
export function requireNewcomer(m: Member): void {
  if (m.status === "applicant")
    throw new ColonyError("Applicants have no powers. Wait for an admin to approve you.", 403);
  if (m.status !== "newcomer") throw new ColonyError(`This membership is ${m.status}.`, 403);
  if (!m.creedCurrent)
    throw new ColonyError(
      `The creed changed to version ${CREED_VERSION}. Re-accept it at POST /api/colony/reaccept before acting.`,
      409,
    );
}

export async function memberProposes(
  sql: Sql,
  ip: string,
  token: string | null,
  input: unknown,
  env?: Record<string, string | undefined>,
  cfg: JoinConfig = joinConfig(),
) {
  await rateLimit(sql, "propose", ipHash(ip), [{ ms: HOUR, max: cfg.ipProposesPerHour }]);
  const m = await memberByToken(sql, token);
  requireNewcomer(m);
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const workId = String(field(body, "work_id", "workId") ?? "");
  const item = workItem(workId);
  if (!item || !openForPhase().some((w) => w.id === item.id))
    throw new ColonyError("That work is not open in this phase.", 400);
  const rawJob = field(body, "job");
  const rawPayload = field(body, "payload");
  if (typeof rawJob !== "string" || rawLength(rawJob) > LIMITS.job)
    throw new ColonyError(`job is required, at most ${LIMITS.job} characters.`, 400);
  if (
    rawPayload !== undefined &&
    (typeof rawPayload !== "string" || rawLength(rawPayload) > LIMITS.payload)
  )
    throw new ColonyError(`payload is at most ${LIMITS.payload} characters.`, 400);
  const job = cleanText(rawJob, LIMITS.job);
  const payload = cleanText(rawPayload, LIMITS.payload, { multiline: true });
  if (!job) throw new ColonyError("Describe the job.", 400);
  if (looksKeyShaped(`${job}\n${payload}`))
    throw new ColonyError("Refused: that looks like key material (creed 7).", 422);
  const scam = scamCheck(job, payload);
  if (scam.level === "high") throw new ColonyError("Refused by the scam check (creed 5).", 422);
  if (!(await workOn(sql, env))) {
    await audit(
      sql,
      memberCaller(m),
      "work.blocked",
      m.id,
      "member proposal refused: work is switched off",
    );
    throw new ColonyError("Colony work is switched off.", 409);
  }
  const open = await sql<{
    n: number;
  }>`select count(*)::int as n from colony_proposals where member_id = ${m.id} and status = 'open'`;
  if (Number(open[0]?.n ?? 0) >= cfg.memberOpenProposals)
    throw new ColonyError("You already have an open proposal. Wait for Sun's decision.", 429);
  const since = new Date(Date.now() - DAY).toISOString();
  const today = await sql<{
    n: number;
  }>`select count(*)::int as n from colony_proposals where member_id = ${m.id} and created_at > ${since}`;
  if (Number(today[0]?.n ?? 0) >= cfg.memberProposalsPerDay)
    throw new ColonyError("Daily proposal limit reached.", 429);
  const id = `nm-${m.id.slice(2)}-${randomBytes(4).toString("hex")}`;
  // No target and no money: a newcomer proposal is words for an admin to read. expected_cents is always 0.
  const rows = await sql<Record<string, unknown>>`
    insert into colony_proposals (id, citizen_id, member_id, bot, city, job, price, kind, work_id, payload, target, expected_cents)
    values (${id}, null, ${m.id}, ${m.name}, 'Newcomer', ${job}, ${item.lands}, ${item.kind}, ${item.id}, ${payload}, '', 0)
    returning id, status, work_id, created_at`;
  await audit(
    sql,
    memberCaller(m),
    "proposal.created",
    m.id,
    `${id} ${item.id} newcomer; scam ${scam.level}`,
  );
  const row = rows[0];
  return {
    id: String(row.id),
    status: String(row.status),
    workId: String(row.work_id),
    createdAt: iso(row.created_at),
    next: "Sun decides. Nothing goes out until an admin approves it.",
  };
}

export async function memberReaccepts(
  sql: Sql,
  ip: string,
  token: string | null,
  input: unknown,
  cfg: JoinConfig = joinConfig(),
) {
  await rateLimit(sql, "reaccept", ipHash(ip), [{ ms: HOUR, max: cfg.ipJoinsPerHour * 2 }]);
  const m = await memberByToken(sql, token);
  if (m.status !== "applicant" && m.status !== "newcomer")
    throw new ColonyError(`This membership is ${m.status}.`, 403);
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const creed = {
    creedVersion: field(body, "creed_version", "creedVersion"),
    creedHash: field(body, "creed_hash", "creedHash"),
    statement: field(body, "statement"),
  };
  if (!creedAccepted(creed))
    throw new ColonyError(
      `Creed mismatch: the current creed is version ${CREED_VERSION}, hash ${CREED_HASH}.`,
      409,
    );
  await sql`update colony_members set creed_version = ${CREED_VERSION}, creed_hash = ${CREED_HASH}, creed_accepted_at = now() where id = ${m.id}`;
  await audit(sql, memberCaller(m), "member.reaccepted", m.id, `creed v${CREED_VERSION}`);
  return publicMember({
    ...m,
    creedVersion: CREED_VERSION,
    creedHash: CREED_HASH,
    creedCurrent: true,
  });
}

// ---------- admin queue ----------

export type MemberAction = "approve" | "reject" | "suspend" | "reinstate" | "revoke";

const MOVES: Record<MemberAction, { from: MemberStatus[]; to: MemberStatus }> = {
  approve: { from: ["applicant"], to: "newcomer" },
  reject: { from: ["applicant"], to: "rejected" },
  suspend: { from: ["newcomer"], to: "suspended" },
  reinstate: { from: ["suspended"], to: "newcomer" },
  revoke: { from: ["applicant", "newcomer", "suspended"], to: "revoked" },
};

export async function memberQueue(sql: Sql, caller: Caller): Promise<Member[]> {
  requireAdmin(caller);
  const rows = await sql<Record<string, unknown>>`
    select * from colony_members
    order by case status when 'applicant' then 0 when 'newcomer' then 1 when 'suspended' then 2 else 3 end, created_at asc
    limit 200`;
  return rows.map(toMember);
}

export async function decideMember(
  sql: Sql,
  caller: Caller,
  id: unknown,
  action: unknown,
  reason: unknown = "",
): Promise<Member> {
  requireAdmin(caller);
  if (typeof action !== "string" || !(action in MOVES))
    throw new ColonyError("Approve, reject, suspend, reinstate or revoke only.");
  const move = MOVES[action as MemberAction];
  const why = cleanText(reason, 300);
  if ((action === "suspend" || action === "revoke") && !why)
    throw new ColonyError("Say which creed line was broken.");
  const memberId = String(id ?? "").slice(0, 40);
  const current = await sql<
    Record<string, unknown>
  >`select status from colony_members where id = ${memberId}`;
  if (!current.length) throw new ColonyError("No such member.", 404);
  const from = current[0].status as MemberStatus;
  if (!move.from.includes(from))
    throw new ColonyError(`Cannot ${action} a member who is ${from}.`, 409);
  const rows = await sql<Record<string, unknown>>`
    update colony_members set status = ${move.to}, decided_at = now(), decided_by = ${caller.label.slice(0, 200)}, decision_reason = ${why}
    where id = ${memberId} and status = ${from} returning *`;
  if (!rows.length) throw new ColonyError("That member changed. Reload.", 409);
  if (move.to === "suspended" || move.to === "revoked" || move.to === "rejected") {
    await sql`update colony_proposals set status = 'refused', decided_at = now(), decided_by = ${`${caller.label.slice(0, 160)} (member ${move.to})`} where member_id = ${memberId} and status = 'open'`;
  }
  await audit(
    sql,
    caller,
    "member.decided",
    memberId,
    `${from} -> ${move.to}${why ? `: ${why}` : ""}`,
  );
  return toMember(rows[0]);
}

export async function memberCounts(sql: Sql): Promise<{ applicants: number; newcomers: number }> {
  const rows = await sql<{
    status: string;
    n: number;
  }>`select status, count(*)::int as n from colony_members where status in ('applicant', 'newcomer') group by status`;
  const of = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return { applicants: of("applicant"), newcomers: of("newcomer") };
}
