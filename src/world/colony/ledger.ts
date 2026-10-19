/**
 * Citizen ledger in real US cents, off-chain. A scoreboard and an audit trail, not a balance a bot
 * can spend. Credits arrive as pending and only count once an admin clears them. Integer cents only.
 * Rows live server-side in colony_ledger; this module holds the shared pure rules.
 */

export type LedgerSource = "internal" | "stripe" | "paypal" | "chain";
export type LedgerState = "pending" | "cleared" | "reversed";

export type LedgerEntry = {
  readonly id: string;
  readonly citizenId: string;
  readonly jobId: string;
  readonly source: LedgerSource;
  readonly ref: string;
  readonly amountCents: number;
  readonly state: LedgerState;
  readonly createdAt: string;
  readonly changedAt: string;
};

export type LedgerTotals = { cleared: number; pending: number; reversed: number };

export const SOURCES: readonly LedgerSource[] = ["internal", "stripe", "paypal", "chain"];

export function validCents(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000
  );
}

/** Allowed moves: pending -> cleared, pending -> reversed, cleared -> reversed. */
export function canMove(from: LedgerState, to: LedgerState): boolean {
  return (
    (from === "pending" && (to === "cleared" || to === "reversed")) ||
    (from === "cleared" && to === "reversed")
  );
}

export function emptyTotals(): LedgerTotals {
  return { cleared: 0, pending: 0, reversed: 0 };
}

export function totalsFrom(
  rows: readonly { citizenId: string; state: LedgerState; amountCents: number }[],
  citizenId: string,
): LedgerTotals {
  const totals = emptyTotals();
  for (const row of rows) if (row.citizenId === citizenId) totals[row.state] += row.amountCents;
  return totals;
}

/** Format integer cents as dollars for display. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
