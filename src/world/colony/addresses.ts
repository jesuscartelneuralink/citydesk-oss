/**
 * Watch-only receive addresses. Sun creates every wallet in his own wallet app, on his own device,
 * and pastes only the PUBLIC address here. The colony stores public addresses and nothing else.
 *
 * Validation is public-address format only:
 * - EVM: 0x followed by exactly 40 hex characters (one address covers every EVM chain).
 * - Solana: base58 that decodes to exactly 32 bytes. A 64-byte decode is a key-shaped value and is
 *   refused outright, never stored, and never echoed back.
 * Anything else (extended keys, word lists, 64-hex strings) is refused.
 *
 * TODO(needs Sun's OK): extended-public-key derivation for EVM needs the ethers v6 dependency
 * (HDNodeWallet.fromExtendedKey -> HDNodeVoidWallet.deriveChild). Not added in P0.
 */
import { audit } from "./audit.ts";
import { CITY_AGENTS } from "./cities.ts";
import { isOperator } from "./work.ts";

export type Chain = "evm" | "solana-devnet" | "solana";

export const CHAINS: readonly { id: Chain; label: string }[] = [
  { id: "evm", label: "EVM (Ethereum, Base, Polygon...)" },
  { id: "solana-devnet", label: "Solana devnet" },
  { id: "solana", label: "Solana" },
];

export type WatchAddress = {
  readonly citizenId: string;
  readonly chain: Chain;
  readonly address: string;
  readonly source: "pasted";
  readonly addedBy: "sun";
  readonly addedAt: number;
};

export type AddressCheck = { ok: true; address: string } | { ok: false; reason: string };

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decoded byte length of a base58 string, or -1 if it is not base58. */
export function base58Length(input: string): number {
  if (!input) return -1;
  const bytes: number[] = [];
  for (const ch of input) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return -1;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (zeros < input.length && input[zeros] === "1") zeros += 1;
  return bytes.length + zeros;
}

export function checkAddress(chain: Chain, raw: string): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "Paste a public address." };
  if (/\s/.test(value))
    return {
      ok: false,
      reason:
        "That looks like a list of words. Never paste those anywhere. Paste a public address only.",
    };
  if (chain === "evm") {
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(value))
      return {
        ok: false,
        reason:
          "That is key-shaped, not an address. It was not stored. Move those funds to a fresh wallet.",
      };
    if (!/^0x[0-9a-fA-F]{40}$/.test(value))
      return { ok: false, reason: "An EVM address is 0x followed by 40 hex characters." };
    return { ok: true, address: value };
  }
  const length = base58Length(value);
  if (length === 64)
    return {
      ok: false,
      reason:
        "That is key-shaped, not an address. It was not stored. Move those funds to a fresh wallet.",
    };
  if (length !== 32)
    return { ok: false, reason: "A Solana address is base58 that decodes to 32 bytes." };
  return { ok: true, address: value };
}

const KEY = "ndu-colony-addresses-v1";
let rows: WatchAddress[] = load();

function load(): WatchAddress[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as WatchAddress[];
    if (!Array.isArray(raw)) return [];
    // Re-validate on load so nothing that fails the public-address check survives in storage.
    return raw.filter((row) => row && checkAddress(row.chain, String(row.address)).ok);
  } catch {
    return [];
  }
}

function save() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* in-memory list still holds */
  }
}

/** Sun pastes a public address for a citizen. Not gated by the work switch: it is Sun's own action. */
export function addWatchAddress(
  actor: string,
  citizenId: string,
  chain: Chain,
  raw: string,
  at = Date.now(),
): AddressCheck {
  if (!isOperator(actor)) return { ok: false, reason: "Only Sun can add an address." };
  if (!CITY_AGENTS.some((row) => row.id === citizenId))
    return { ok: false, reason: "Unknown citizen." };
  const check = checkAddress(chain, raw);
  if (!check.ok) {
    // Never log the rejected value itself.
    audit(actor, "address.rejected", citizenId, `${chain}: ${check.reason}`, at);
    return check;
  }
  if (
    rows.some(
      (row) => row.chain === chain && row.address.toLowerCase() === check.address.toLowerCase(),
    )
  ) {
    return { ok: false, reason: "That address is already on the list." };
  }
  rows = [
    ...rows,
    Object.freeze({
      citizenId,
      chain,
      address: check.address,
      source: "pasted",
      addedBy: "sun",
      addedAt: at,
    }),
  ];
  save();
  audit(actor, "address.added", citizenId, `${chain} ${check.address}`, at);
  return check;
}

export function addressesOf(citizenId: string): readonly WatchAddress[] {
  return rows.filter((row) => row.citizenId === citizenId);
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

/** Tests only. */
export function resetAddressesForTests(): void {
  rows = [];
}
