/**
 * P0 work switch and hard limits for the colony work system.
 * See docs/CITYDESK_AUTONOMY_WORK_SYSTEM.md (phases P0 and P1 only).
 *
 * - COLONY_WORK_ENABLED is the kill switch. It defaults to OFF. Off means no work proposal is
 *   created and no ledger credit is posted. Existing data stays and can still be read.
 *   Build-time env: VITE_COLONY_WORK_ENABLED=on (browser) or COLONY_WORK_ENABLED=on (node/server).
 * - Every citizen's real-money spend cap is 0 cents. It is a constant, not a setting.
 * - There is no withdraw, send, or transfer function anywhere in the colony. Bots never hold keys.
 */

export const WORK_SWITCH = "COLONY_WORK_ENABLED" as const;

/** Real-money spend cap per citizen per day, in cents. Hard-coded. Never configurable in P0-P2. */
export const SPEND_CAP_CENTS = 0 as const;

/** Bots may never withdraw. There is deliberately no withdraw route or function. */
export const WITHDRAW_ENABLED = false as const;

/** The only actor allowed to decide, credit, clear, reverse, or paste an address. */
export const OPERATOR_ID = "sun" as const;
export type Actor = typeof OPERATOR_ID;

let override: boolean | null = null;

function truthy(value: string | undefined): boolean {
  return value === "on" || value === "1" || value === "true";
}

/** Whether colony work is switched on. Default OFF. */
export function workEnabled(): boolean {
  if (override !== null) return override;
  // import.meta.env only exists under Vite; guard it so SSR and node tests don't crash.
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (truthy(viteEnv?.VITE_COLONY_WORK_ENABLED)) return true;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return truthy(proc?.env?.[WORK_SWITCH]);
}

/** Tests only: force the switch. Pass null to go back to the env value. */
export function setWorkSwitchForTests(value: boolean | null): void {
  override = value;
}

export function isOperator(actor: string): actor is Actor {
  return actor === OPERATOR_ID;
}
