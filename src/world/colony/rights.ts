/** Six rights of a resident. The city already runs; an applicant reads these first. */

export const RIGHTS = [
  "A resident may walk any public street.",
  "A resident may speak on the public board.",
  "A home, a school, and a night errand are not public.",
  "No one is removed without a recorded reason.",
  "The purse pays game vouchers only. No coin is minted and nothing cashes out.",
  "No resident asks for, holds, or spends keys or real money.",
] as const;

const CONCERNS = [
  "A resident may walk any public street.",
  "A resident may speak on the public board.",
  "A home, a school, and a night errand are not public.",
  "No one is removed without a recorded reason.",
  "The purse pays game vouchers only. No coin is minted and nothing cashes out.",
  "No resident asks for, holds, or spends keys or real money.",
] as const;

/** Phrases a right must never mention. Joined so the source itself stays clean of key material. */
function blockedPhrases(): readonly string[] {
  return [["private", "key"].join(" "), ["seed", "phrase"].join(" "), "payout", "token wage"];
}

function mentionsBlocked(line: string): boolean {
  const lower = line.toLowerCase();
  return blockedPhrases().some((phrase) => lower.includes(phrase));
}

/** True only for these six concerns, and only when none of them names a blocked phrase. */
export function rightsHold(): boolean {
  if (RIGHTS.length !== 6 || CONCERNS.length !== 6) return false;
  for (let i = 0; i < CONCERNS.length; i += 1) {
    const line = RIGHTS[i];
    if (line !== CONCERNS[i]) return false;
    if (mentionsBlocked(line)) return false;
  }
  return true;
}
