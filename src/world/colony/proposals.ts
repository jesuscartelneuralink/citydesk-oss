/**
 * Jobs a bot may propose. Approving one records your decision. It does not sign, spend, or reveal a key.
 * Proposals live server-side in colony_proposals; only a logged-in admin can approve or refuse
 * (work.server.ts). This module holds the shared types, the original seed jobs, and pure checks.
 */
import { CURRENT_PHASE, workItem, type WorkKind } from "./catalog.ts";
import { CITY_AGENTS } from "./cities.ts";

export type ProposalKind = "ride" | "stall" | "compute" | WorkKind;
export type ProposalStatus = "open" | "approved" | "refused";

export type Proposal = {
  id: string;
  bot: string;
  city: string;
  job: string;
  price: string;
  status: ProposalStatus;
  kind: ProposalKind;
  citizenId: string | null;
  workId: string | null;
  /** The exact draft text or file hash the admin is approving. */
  payload: string;
  /** Platform or URL the outward step would go to. The admin performs that step by hand. */
  target: string;
  expectedCents: number;
  createdAt: string | null;
  decidedAt: string | null;
  /** Label of the real admin account that decided. */
  decidedBy: string | null;
};

/** The original three jobs. The migration seeds them into colony_proposals. */
export const SEED: readonly Pick<Proposal, "id" | "bot" | "city" | "job" | "price" | "kind">[] = [
  {
    id: "ride-kemi",
    bot: "Kemi",
    city: "Port Harcourt",
    job: "A keke ride between two public stops",
    price: "The fare is paid to the driver, in your wallet",
    kind: "ride",
  },
  {
    id: "stall-chioma",
    bot: "Chioma",
    city: "Lagos",
    job: "One stall hour at the public market",
    price: "The fee is paid to the shop, in your wallet",
    kind: "stall",
  },
  {
    id: "compute-eko",
    bot: "Eko",
    city: "Port Harcourt",
    job: "One sandboxed job from our own catalog",
    price: "The fee is paid for that job, in your wallet",
    kind: "compute",
  },
];

export type WorkProposalInput = {
  citizenId: string;
  workId: string;
  job: string;
  payload: string;
  target: string;
  expectedCents: number;
};

export type ProposalCheck =
  | { ok: true; kind: WorkKind; price: string; bot: string; city: string }
  | { ok: false; reason: string };

/** Pure validation for a new work proposal, given how many open proposals the citizen holds. */
export function checkWorkProposal(
  input: WorkProposalInput,
  openCount: number,
  openLimit: number,
  phase: number = CURRENT_PHASE,
): ProposalCheck {
  const agent = CITY_AGENTS.find((row) => row.id === input.citizenId);
  if (!agent) return { ok: false, reason: "Unknown citizen." };
  const item = workItem(input.workId);
  if (!item || item.phase > phase)
    return { ok: false, reason: "That work is not open in this phase." };
  if (!Number.isSafeInteger(input.expectedCents) || input.expectedCents < 0)
    return { ok: false, reason: "Expected amount must be whole cents." };
  if (!input.job.trim()) return { ok: false, reason: "Describe the job." };
  if (openCount >= openLimit)
    return { ok: false, reason: "This citizen already has an open proposal." };
  return { ok: true, kind: item.kind, price: item.lands, bot: agent.name, city: agent.city };
}
