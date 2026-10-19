/**
 * Citizen records for the colony work system. The citizen id is the existing agent id in cities.ts.
 * Status follows the 1-cent rule: at least 1 cleared real cent makes a Prominent Member.
 * Pending cents never count. A reversed cent can take the status back away.
 * Perks are in-game only. Nothing here can spend, send, or cash out.
 */
import { CITY_AGENTS, type CityAgent } from "./cities.ts";
import { emptyTotals, type LedgerTotals } from "./ledger.ts";
import { SPEND_CAP_CENTS } from "./work.ts";

export type CitizenStatus = "resident" | "prominent";

export type Citizen = {
  readonly citizenId: string;
  readonly name: string;
  readonly cityId: string;
  readonly city: string;
  readonly status: CitizenStatus;
  readonly totals: LedgerTotals;
  readonly spendCapCents: typeof SPEND_CAP_CENTS;
  readonly perks: readonly string[];
  readonly openProposalLimit: number;
};

/** The threshold, in cleared cents. */
export const PROMINENT_AT_CENTS = 1;

/** In-game perks only. No cash, no keys, no withdrawal. */
export const PROMINENT_PERKS = [
  "A Prominent badge on the map",
  "A seat at the council office",
  "May have two open proposals instead of one",
  "Name on the city plaque",
] as const;

export function statusFor(clearedCents: number): CitizenStatus {
  return clearedCents >= PROMINENT_AT_CENTS ? "prominent" : "resident";
}

export function isCitizen(citizenId: string): boolean {
  return CITY_AGENTS.some((row) => row.id === citizenId);
}

function toCitizen(agent: CityAgent, totals: LedgerTotals): Citizen {
  const status = statusFor(totals.cleared);
  return {
    citizenId: agent.id,
    name: agent.name,
    cityId: agent.cityId,
    city: agent.city,
    status,
    totals,
    spendCapCents: SPEND_CAP_CENTS,
    perks: status === "prominent" ? PROMINENT_PERKS : [],
    openProposalLimit: status === "prominent" ? 2 : 1,
  };
}

/** Every citizen with totals from a map of citizenId -> totals (missing = zero). */
export function citizensFrom(
  totals: ReadonlyMap<string, LedgerTotals> = new Map(),
): readonly Citizen[] {
  return CITY_AGENTS.map((agent) => toCitizen(agent, totals.get(agent.id) ?? emptyTotals()));
}

export function welcomeLine(citizenId: string): string {
  const agent = CITY_AGENTS.find((row) => row.id === citizenId);
  return agent
    ? `${agent.name} earned a first real cent. ${agent.city} welcomes a Prominent Member.`
    : "";
}

/** CI guard: every citizen's real spend cap is 0 and nobody has a cash-out perk. */
export function workCharterHolds(): boolean {
  return (
    citizensFrom().every(
      (row) =>
        row.spendCapCents === 0 &&
        row.perks.every((perk) => !/cash|withdraw|payout|transfer/i.test(perk)),
    ) && PROMINENT_PERKS.every((perk) => !/cash|withdraw|payout|transfer/i.test(perk))
  );
}
