/**
 * Citizen records for the colony work system. The citizen id is the existing agent id in cities.ts.
 * Status follows the 1-cent rule: at least 1 cleared real cent makes a Prominent Member.
 * Pending cents never count. A reversed cent can take the status back away.
 * Perks are in-game only. Nothing here can spend, send, or cash out.
 */
import { audit } from "./audit.ts";
import { CITY_AGENTS, type CityAgent } from "./cities.ts";
import { totalsOf, type LedgerTotals } from "./ledger.ts";
import { OPERATOR_ID, SPEND_CAP_CENTS } from "./work.ts";

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

function toCitizen(agent: CityAgent): Citizen {
  const totals = totalsOf(agent.id);
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

export function citizens(): readonly Citizen[] {
  return CITY_AGENTS.map(toCitizen);
}

export function citizen(citizenId: string): Citizen | null {
  const agent = CITY_AGENTS.find((row) => row.id === citizenId);
  return agent ? toCitizen(agent) : null;
}

const lastSeen = new Map<string, CitizenStatus>();

/**
 * Compare each citizen's status with the last one seen and write an audit row for any change.
 * Returns the welcome lines for new Prominent Members, for the colony feed.
 */
export function noteStatusChanges(at = Date.now()): string[] {
  const lines: string[] = [];
  for (const row of citizens()) {
    const before = lastSeen.get(row.citizenId) ?? "resident";
    if (before !== row.status) {
      audit(OPERATOR_ID, "status.changed", row.citizenId, `${before} -> ${row.status}`, at);
      if (row.status === "prominent")
        lines.push(
          `${row.name} earned a first real cent. ${row.city} welcomes a Prominent Member.`,
        );
    }
    lastSeen.set(row.citizenId, row.status);
  }
  return lines;
}

/** CI guard: every citizen's real spend cap is 0 and nobody has a cash-out perk. */
export function workCharterHolds(): boolean {
  return citizens().every(
    (row) =>
      row.spendCapCents === 0 &&
      row.perks.every((perk) => !/cash|withdraw|payout|transfer/i.test(perk)),
  );
}

/** Tests only. */
export function resetStatusForTests(): void {
  lastSeen.clear();
}
