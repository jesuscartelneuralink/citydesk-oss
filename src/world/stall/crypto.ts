import { randomBytes } from "node:crypto";
import { base58Length, checkAddress } from "@/world/colony/addresses";

/** Circle USDC on Solana. The plate is 1 USDC. The payer cannot change it. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const PLATE_USDC_BASE = 1_000_000;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
}

/** A public reference for this plate. The secret half is never kept. */
export function newChainRef(): string {
  return encodeBase58(randomBytes(32));
}

export function merchantOk(raw: string | undefined): string | null {
  if (!raw) return null;
  const checked = checkAddress("solana", raw);
  if (!checked.ok || checked.address === USDC_MINT) return null;
  return checked.address;
}

export function txSignatureOk(raw: string): boolean {
  return base58Length(raw.trim()) === 64;
}

export function payUrl(merchant: string, chainRef: string): string {
  const query = new URLSearchParams({
    amount: "1",
    "spl-token": USDC_MINT,
    reference: chainRef,
    label: "CityDesk stall",
    message: "A plate at the public stall",
  });
  return `solana:${merchant}?${query.toString()}`;
}

type Balance = { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } };

function owned(list: Balance[] | undefined, merchant: string): bigint {
  const hit = (list ?? []).find((row) => row.owner === merchant && row.mint === USDC_MINT);
  try {
    return BigInt(hit?.uiTokenAmount?.amount ?? "0");
  } catch {
    return 0n;
  }
}

/** True only when this plate's reference was paid at least 1 USDC and the transfer succeeded. */
export function usdcReceived(tx: unknown, merchant: string, chainRef: string): boolean {
  if (!tx || typeof tx !== "object") return false;
  const row = tx as {
    meta?: { err?: unknown; preTokenBalances?: Balance[]; postTokenBalances?: Balance[] } | null;
    transaction?: { message?: { accountKeys?: unknown[] } };
  };
  if (!row.meta || row.meta.err) return false;
  const keys = (row.transaction?.message?.accountKeys ?? []).map((key) =>
    typeof key === "string" ? key : ((key as { pubkey?: string }).pubkey ?? ""),
  );
  if (!keys.includes(chainRef) || !keys.includes(merchant)) return false;
  return owned(row.meta.postTokenBalances, merchant) - owned(row.meta.preTokenBalances, merchant) >= BigInt(PLATE_USDC_BASE);
}
