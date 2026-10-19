/** Jobs a bot may propose. Approving one records your decision. It does not sign, spend, or reveal a key. */
import { audit } from "./audit.ts";
import { workItem, CURRENT_PHASE, type WorkKind } from "./catalog.ts";
import { CITY_AGENTS } from "./cities.ts";
import { isOperator, OPERATOR_ID, workEnabled } from "./work.ts";

export type ProposalKind = "ride" | "stall" | "compute" | WorkKind;

export type Proposal = {
  id: string;
  bot: string;
  city: string;
  job: string;
  price: string;
  status: "open" | "approved" | "refused";
  /** Work-system fields (P0/P1). Optional so the original seed proposals stay as they were. */
  kind?: ProposalKind;
  citizenId?: string;
  workId?: string;
  /** The exact draft text or file hash Sun is approving. */
  payload?: string;
  /** Platform or URL the outward step would go to. Sun performs that step himself. */
  target?: string;
  expectedCents?: number;
  createdAt?: number;
  decidedAt?: number;
  decidedBy?: "sun";
};

const KEY = "ndu-proposals-v1";

const SEED: readonly Proposal[] = [
  {
    id: "ride-kemi",
    bot: "Kemi",
    city: "Port Harcourt",
    job: "A keke ride between two public stops",
    price: "The fare is paid to the driver, in your wallet",
    status: "open",
  },
  {
    id: "stall-chioma",
    bot: "Chioma",
    city: "Lagos",
    job: "One stall hour at the public market",
    price: "The fee is paid to the shop, in your wallet",
    status: "open",
  },
  {
    id: "compute-eko",
    bot: "Eko",
    city: "Port Harcourt",
    job: "One sandboxed job from our own catalog",
    price: "The fee is paid for that job, in your wallet",
    status: "open",
  },
];

const WORK_KEY = "ndu-colony-work-proposals-v1";

let rows: Proposal[] = load();

function decided(status: unknown): Proposal["status"] {
  return status === "approved" || status === "refused" ? status : "open";
}

function loadWork(): Proposal[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(WORK_KEY) || "[]") as Proposal[];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((row) => typeof row?.id === "string" && typeof row.citizenId === "string" && typeof row.job === "string")
      .map((row) => ({ ...row, status: decided(row.status) }));
  } catch {
    return [];
  }
}

function load(): Proposal[] {
  if (typeof localStorage === "undefined") return SEED.map((row) => ({ ...row }));
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "") as Proposal[];
    if (!Array.isArray(raw)) return [...SEED.map((row) => ({ ...row })), ...loadWork()];
    const seeds = SEED.map((seed) => {
      const saved = raw.find((row) => row.id === seed.id);
      return { ...seed, status: decided(saved?.status) };
    });
    return [...seeds, ...loadWork()];
  } catch {
    return [...SEED.map((row) => ({ ...row })), ...loadWork()];
  }
}

function save() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.filter((row) => !row.citizenId).map((row) => ({ id: row.id, status: row.status }))));
    localStorage.setItem(WORK_KEY, JSON.stringify(rows.filter((row) => row.citizenId)));
  } catch {
    /* in-memory list still holds */
  }
}

export function proposals(): readonly Proposal[] {
  return rows;
}

/**
 * Record Sun's Approve or Refuse. Only Sun decides, and a decided proposal cannot be re-decided.
 * Approving never signs, spends, sends, or reveals a key: the outward step is done by Sun, by hand.
 */
export function decideProposal(id: string, status: "approved" | "refused", actor: string = OPERATOR_ID, at = Date.now()): boolean {
  if (!isOperator(actor)) return false;
  const row = rows.find((item) => item.id === id);
  if (!row || row.status !== "open") return false;
  rows = rows.map((item) => (item.id === id ? { ...item, status, decidedAt: at, decidedBy: OPERATOR_ID } : item));
  save();
  audit(actor, "proposal.decided", row.citizenId ?? row.bot, `${id} ${status}`, at);
  return true;
}

export type WorkProposalInput = {
  citizenId: string;
  workId: string;
  job: string;
  payload: string;
  target: string;
  expectedCents: number;
  /** How many open proposals this citizen may hold (1, or 2 for a Prominent Member). */
  openLimit?: number;
};

export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; reason: string };

/**
 * A citizen files a work proposal from the catalog. It waits for Sun's Approve or Refuse.
 * Refused when the kill switch is off, the work item is unknown or not open in this phase, the
 * amount is not whole cents, or the citizen already holds its open-proposal limit.
 */
export function proposeWork(input: WorkProposalInput, at = Date.now()): ProposeResult {
  if (!workEnabled()) {
    audit(input.citizenId, "work.blocked", input.citizenId, "proposal refused: COLONY_WORK_ENABLED is off", at);
    return { ok: false, reason: "Colony work is switched off." };
  }
  const agent = CITY_AGENTS.find((row) => row.id === input.citizenId);
  if (!agent) return { ok: false, reason: "Unknown citizen." };
  const item = workItem(input.workId);
  if (!item || item.phase > CURRENT_PHASE) return { ok: false, reason: "That work is not open in this phase." };
  if (!Number.isSafeInteger(input.expectedCents) || input.expectedCents < 0) return { ok: false, reason: "Expected amount must be whole cents." };
  const limit = input.openLimit ?? 1;
  const open = rows.filter((row) => row.citizenId === input.citizenId && row.status === "open").length;
  if (open >= limit) return { ok: false, reason: "This citizen already has an open proposal." };
  const proposal: Proposal = {
    id: `work-${input.citizenId}-${at.toString(36)}-${rows.length}`,
    bot: agent.name,
    city: agent.city,
    job: input.job.slice(0, 200),
    price: item.lands,
    status: "open",
    kind: item.kind,
    citizenId: input.citizenId,
    workId: item.id,
    payload: input.payload.slice(0, 4000),
    target: input.target.slice(0, 200),
    expectedCents: input.expectedCents,
    createdAt: at,
  };
  rows = [...rows, proposal];
  save();
  audit(input.citizenId, "proposal.created", input.citizenId, `${proposal.id} ${item.id} ${input.expectedCents}c`, at);
  return { ok: true, proposal };
}

/** Tests only: drop work proposals and reopen the seeds. */
export function resetProposalsForTests(): void {
  rows = SEED.map((row) => ({ ...row }));
}
