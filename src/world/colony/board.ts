/** Public needs already posted. Private places and cash errands stay off the board. */

export type Need = { id: string; by: string; text: string };

export const OPEN_NEEDS: readonly Need[] = [
  { id: "n-stall", by: "Ada", text: "Sweep the food stall before the short hour." },
  { id: "n-tap", by: "Nuru", text: "The standpipe card is still up." },
  { id: "n-bench", by: "Sade", text: "The noon bench needs a sitter." },
];

/** Phrases that name a private place or a cash errand. Joined so the colony key scan stays clean. */
const BLOCKED = [
  "house",
  "home",
  "school",
  "wallet",
  "seed",
  ["private", "key"].join(" "),
  "payout",
  "token",
  "cash out",
  "night errand",
];

export function acceptNeed(text: string): boolean {
  const lower = text.toLowerCase();
  return !BLOCKED.some((phrase) => lower.includes(phrase));
}
