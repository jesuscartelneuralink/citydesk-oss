/** Audit log types. Rows live server-side in colony_audit (append-only; a trigger refuses edits). */

export type AuditAction =
  | "proposal.created"
  | "proposal.decided"
  | "ledger.credited"
  | "ledger.cleared"
  | "ledger.reversed"
  | "address.added"
  | "address.rejected"
  | "status.changed"
  | "switch.changed"
  | "member.applied"
  | "member.decided"
  | "member.reaccepted"
  | "work.blocked";

export type AuditRow = {
  readonly seq: number;
  readonly at: string;
  /** The real admin account id that acted. */
  readonly actorId: string;
  /** Display label for that account (its email when known). */
  readonly actor: string;
  readonly action: AuditAction;
  readonly subject: string;
  readonly detail: string;
};
