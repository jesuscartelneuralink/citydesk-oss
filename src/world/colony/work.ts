/**
 * Work switch and hard limits for the colony work system (P0/P1).
 * See docs/CITYDESK_AUTONOMY_WORK_SYSTEM.md.
 *
 * - Two gates, both default OFF. The server env COLONY_WORK_ENABLED=on is the hard kill switch.
 *   The admin "work switch" (stored server-side, admin login required) is the soft switch.
 *   Work is on only when both are on. Off means no proposal is created and no credit posts.
 * - Every citizen's real-money spend cap is 0 cents. It is a constant, not a setting.
 * - There is no withdraw, send, or transfer function anywhere in the colony. Bots never hold keys.
 * - Every Sun-only action is checked SERVER-side against the admin login (work.server.ts).
 */

export const WORK_SWITCH = "COLONY_WORK_ENABLED" as const;

/** Real-money spend cap per citizen per day, in cents. Hard-coded. Never configurable in P0-P2. */
export const SPEND_CAP_CENTS = 0 as const;

/** Bots may never withdraw. There is deliberately no withdraw route or function. */
export const WITHDRAW_ENABLED = false as const;

function truthy(value: string | undefined): boolean {
  return value === "on" || value === "1" || value === "true";
}

/** The server env kill switch. Default OFF. */
export function workEnvAllowed(
  env: Record<string, string | undefined> | undefined = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env,
): boolean {
  return truthy(env?.[WORK_SWITCH]);
}

/** Work runs only when the env kill switch AND the admin switch are both on. */
export function workEffective(envAllowed: boolean, adminSwitchOn: boolean): boolean {
  return envAllowed && adminSwitchOn;
}
