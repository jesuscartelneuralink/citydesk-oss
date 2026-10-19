/**
 * Citizen ledger in real US cents, off-chain. A scoreboard and an audit trail, not a balance a bot
 * can spend. Credits arrive as pending and only count once Sun clears them. Integer cents only.
 */
import { audit } from "./audit.ts";
import { isOperator, workEnabled } from "./work.ts";

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
  readonly createdAt: number;
  readonly changedAt: number;
};

export type LedgerTotals = { cleared: number; pending: number; reversed: number };

const KEY = "ndu-colony-ledger-v1";
let rows: LedgerEntry[] = load();
let counter = rows.length;

function valid(row: LedgerEntry): boolean {
  return (
    typeof row?.id === "string" &&
    typeof row.citizenId === "string" &&
    Number.isSafeInteger(row.amountCents) &&
    row.amountCents > 0 &&
    (row.state === "pending" || row.state === "cleared" || row.state === "reversed")
  );
}

function load(): LedgerEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as LedgerEntry[];
    return Array.isArray(raw) ? raw.filter(valid) : [];
  } catch {
    return [];
  }
}

function save() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* in-memory ledger still holds */
  }
}

export type CreditInput = {
  citizenId: string;
  jobId: string;
  source: LedgerSource;
  ref: string;
  amountCents: number;
};

/**
 * Record a credit as pending. Sun only, kill switch must be on, positive integer cents only.
 * P0 uses source "internal" (W3 drafts for Sun's own projects). Stripe/PayPal/chain matching is P1+.
 */
export function credit(actor: string, input: CreditInput, at = Date.now()): LedgerEntry | null {
  if (!workEnabled()) {
    audit(actor, "work.blocked", input.citizenId, "credit refused: COLONY_WORK_ENABLED is off", at);
    return null;
  }
  if (!isOperator(actor)) return null;
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return null;
  counter += 1;
  const row: LedgerEntry = Object.freeze({
    id: `cr-${at.toString(36)}-${counter}`,
    citizenId: input.citizenId,
    jobId: input.jobId,
    source: input.source,
    ref: input.ref.slice(0, 120),
    amountCents: input.amountCents,
    state: "pending",
    createdAt: at,
    changedAt: at,
  });
  rows = [...rows, row];
  save();
  audit(
    actor,
    "ledger.credited",
    input.citizenId,
    `${row.id} ${row.amountCents}c pending (${row.source})`,
    at,
  );
  return row;
}

function move(actor: string, id: string, from: LedgerState, to: LedgerState, at: number): boolean {
  if (!isOperator(actor)) return false;
  const row = rows.find((item) => item.id === id);
  if (!row || row.state !== from) return false;
  if (to === "cleared" && !workEnabled()) {
    audit(
      actor,
      "work.blocked",
      row.citizenId,
      `clear refused: COLONY_WORK_ENABLED is off (${id})`,
      at,
    );
    return false;
  }
  rows = rows.map((item) =>
    item.id === id ? Object.freeze({ ...item, state: to, changedAt: at }) : item,
  );
  save();
  audit(
    actor,
    to === "cleared" ? "ledger.cleared" : "ledger.reversed",
    row.citizenId,
    `${id} ${row.amountCents}c ${from} -> ${to}`,
    at,
  );
  return true;
}

/** pending -> cleared, after the clearing buffer. Sun only. */
export function clearCredit(actor: string, id: string, at = Date.now()): boolean {
  return move(actor, id, "pending", "cleared", at);
}

/** pending or cleared -> reversed (chargeback, reorg, rule break). Sun only. Always allowed. */
export function reverseCredit(actor: string, id: string, at = Date.now()): boolean {
  return move(actor, id, "pending", "reversed", at) || move(actor, id, "cleared", "reversed", at);
}

export function ledgerOf(citizenId: string): readonly LedgerEntry[] {
  return rows.filter((row) => row.citizenId === citizenId);
}

export function totalsOf(citizenId: string): LedgerTotals {
  const totals: LedgerTotals = { cleared: 0, pending: 0, reversed: 0 };
  for (const row of rows) if (row.citizenId === citizenId) totals[row.state] += row.amountCents;
  return totals;
}

export function allEntries(): readonly LedgerEntry[] {
  return rows;
}

/** Format integer cents as dollars for display. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Tests only. */
export function resetLedgerForTests(): void {
  rows = [];
  counter = 0;
}
