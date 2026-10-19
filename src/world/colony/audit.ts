/** Append-only audit log for colony work: proposals, decisions, ledger changes, addresses, status. */

export type AuditAction =
  | "proposal.created"
  | "proposal.decided"
  | "ledger.credited"
  | "ledger.cleared"
  | "ledger.reversed"
  | "address.added"
  | "address.rejected"
  | "status.changed"
  | "work.blocked";

export type AuditRow = {
  readonly seq: number;
  readonly at: number;
  readonly actor: string;
  readonly action: AuditAction;
  readonly subject: string;
  readonly detail: string;
};

const KEY = "ndu-colony-audit-v1";
const MAX = 500;

let rows: AuditRow[] = load();

function load(): AuditRow[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as AuditRow[];
    return Array.isArray(raw) ? raw.filter((row) => typeof row?.seq === "number").slice(-MAX) : [];
  } catch {
    return [];
  }
}

function save() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
  } catch {
    /* storage full or blocked: the in-memory log still holds */
  }
}

export function audit(
  actor: string,
  action: AuditAction,
  subject: string,
  detail = "",
  at = Date.now(),
): AuditRow {
  const row: AuditRow = Object.freeze({
    seq: (rows.at(-1)?.seq ?? 0) + 1,
    at,
    actor,
    action,
    subject,
    detail,
  });
  rows = [...rows, row];
  save();
  return row;
}

/** Newest last. Rows are frozen; there is no edit or delete. */
export function auditLog(): readonly AuditRow[] {
  return rows;
}

/** Tests only. */
export function resetAuditForTests(): void {
  rows = [];
}
