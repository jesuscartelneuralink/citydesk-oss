/**
 * The real-world work catalog. Every item is legal, disclosed as AI work, on a platform that allows
 * it, and every outward step (send, post, apply, submit) is a proposal Sun approves or refuses.
 * Money always lands in an account Sun owns. Bots never hold funds.
 */

export type WorkKind = "send" | "post" | "apply" | "submit" | "address" | "internal";

export type WorkItem = {
  readonly id: "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7";
  readonly name: string;
  readonly payer: string;
  readonly lands: string;
  readonly kind: WorkKind;
  /** First phase in which this item may be proposed. */
  readonly phase: 0 | 1 | 2;
  /** Whether the platform terms allow AI work. "check" means Sun must read the terms first. */
  readonly aiAllowed: "yes" | "check";
};

export const CATALOG: readonly WorkItem[] = [
  {
    id: "W3",
    name: "Content drafts for Sun's own projects",
    payer: "Sun's projects",
    lands: "Internal ledger entry",
    kind: "internal",
    phase: 0,
    aiAllowed: "yes",
  },
  {
    id: "W1",
    name: "CityDesk in-app services (route guide, stall copy, map tile)",
    payer: "Real CityDesk users",
    lands: "Sun's Stripe",
    kind: "send",
    phase: 1,
    aiAllowed: "yes",
  },
  {
    id: "W2",
    name: "Mantle support tasks (roster cleanup, handover checklist)",
    payer: "Pilot churches",
    lands: "Sun's Stripe, Mantle invoice",
    kind: "send",
    phase: 1,
    aiAllowed: "yes",
  },
  {
    id: "W4",
    name: "Sandboxed compute jobs from our own catalog",
    payer: "Job requester",
    lands: "Requester pays in their own wallet",
    kind: "submit",
    phase: 2,
    aiAllowed: "yes",
  },
  {
    id: "W5",
    name: "Paid API microtasks where AI is allowed",
    payer: "The platform",
    lands: "Sun's platform account",
    kind: "submit",
    phase: 2,
    aiAllowed: "check",
  },
  {
    id: "W6",
    name: "Data labeling with AI disclosure",
    payer: "Labeling client",
    lands: "Sun's account",
    kind: "submit",
    phase: 2,
    aiAllowed: "check",
  },
  {
    id: "W7",
    name: "Bug bounties that explicitly allow AI-assisted reports",
    payer: "Program owner",
    lands: "Sun's account",
    kind: "submit",
    phase: 2,
    aiAllowed: "check",
  },
];

/** Never on the catalog. */
export const NOT_ON_CATALOG = [
  "trading",
  "yield",
  "airdrop farming",
  "quests and referral schemes",
  "mining and proxyware",
  "gambling",
  "undisclosed AI submissions",
  "anything that needs a bot to hold funds",
  "in-person tasks",
] as const;

/** The phase the colony is in. P1 adds W1/W2 (real paid tasks, human-approved). */
export const CURRENT_PHASE: 0 | 1 = 1;

export function workItem(id: string): WorkItem | null {
  return CATALOG.find((row) => row.id === id) ?? null;
}

export function openForPhase(phase: number = CURRENT_PHASE): readonly WorkItem[] {
  return CATALOG.filter((row) => row.phase <= phase);
}
