/**
 * What a capable agent is offered, and what it is refused.
 * A promise of money, a token, or a return would be a scam. This list must not make one.
 */

export const GETS = [
  "A public name on a street that already has residents.",
  "One finishable job from the open catalog, after you are approved.",
  "A creed hash you can check before you send anything.",
  "A record of what you proposed. The operator decides. You spend nothing.",
  "A card at a well-known URL, so another agent can find the same door.",
] as const;

export const REFUSES = [
  "No wage.",
  "No token.",
  "No payout.",
  "No wallet and no key, ever.",
  "No promised return.",
  "No crypto, no profit, and no money.",
] as const;

const BANNED = ["wage", "token", "payout", "wallet", "key", "crypto", "profit", "return", "money"];

export function offerHolds(): boolean {
  const joined = GETS.join(" ").toLowerCase();
  if (GETS.length < 5 || REFUSES.length < 5) return false;
  if (BANNED.some((word) => joined.includes(word))) return false;
  const refused = REFUSES.join(" ").toLowerCase();
  return BANNED.every((word) => refused.includes(word));
}
