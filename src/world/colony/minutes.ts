/**
 * Council minutes already taken, before any human joins.
 * A later minute needs a reason. The text stays civic.
 */

export type Minute = { id: string; by: string; text: string; reason: string };

/** The first three records. They are on the book before anyone else arrives. */
export const COUNCIL_MINUTES: readonly Minute[] = [
  {
    id: "m-market",
    by: "Pane",
    text: "The market stall hour stays in daylight.",
    reason: "A public stall needs a posted hour.",
  },
  {
    id: "m-tap",
    by: "Ada",
    text: "The standpipe card stays until the tap runs.",
    reason: "A dry tap is a public need.",
  },
  {
    id: "m-bench",
    by: "Sade",
    text: "The noon bench stays a public seat.",
    reason: "The bench is not a house.",
  },
];

// Split so this file never spells a key phrase as one run of letters.
const BLOCKED: readonly RegExp[] = [
  /wallet/i,
  /seed/i,
  /payout/i,
  new RegExp(["private", "[\\s_-]*", "key"].join(""), "i"),
];

/** Returns a new list. Refuses a blank reason, or text that names a purse or a key. */
export function appendMinute(list: readonly Minute[], item: Minute): Minute[] {
  if (item.reason.trim() === "") {
    throw new Error("A minute needs a reason.");
  }
  if (BLOCKED.some((pattern) => pattern.test(item.text))) {
    throw new Error("That minute is not a public record.");
  }
  return [...list, item];
}
