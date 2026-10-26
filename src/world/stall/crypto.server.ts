import type { Sql } from "@/lib/db";
import { STALL_MEAL, newMealReference } from "./till";
import {
  PLATE_USDC_BASE,
  merchantOk,
  newChainRef,
  payUrl,
  txSignatureOk,
  usdcReceived,
} from "./crypto";

export async function openStallUsdc(
  sql: Sql,
  userId: string,
  opts: { merchant: string | undefined },
) {
  const merchant = merchantOk(opts.merchant);
  if (!merchant) return { status: 503 as const, error: "The crypto till is not connected yet." };
  const reference = newMealReference();
  const chainRef = newChainRef();
  await sql`
    insert into stall_payments (reference, user_id, sku, kobo, status, rail, chain_ref, usdc_base)
    values (${reference}, ${userId}, ${STALL_MEAL.sku}, ${STALL_MEAL.kobo}, 'pending', 'usdc', ${chainRef}, ${PLATE_USDC_BASE})`;
  return {
    status: 201 as const,
    reference,
    address: merchant,
    url: payUrl(merchant, chainRef),
    amount: "1",
    symbol: "USDC",
  };
}

export async function confirmStallUsdc(
  sql: Sql,
  input: { reference?: string; signature?: string },
  opts: { merchant: string | undefined; rpc?: string; fetchImpl?: typeof fetch },
) {
  const merchant = merchantOk(opts.merchant);
  const reference = input.reference ?? "";
  const signature = (input.signature ?? "").trim();
  if (!merchant) return { status: 503 as const, error: "The crypto till is not connected yet." };
  if (!/^meal_[0-9a-f]{24}$/.test(reference) || !txSignatureOk(signature))
    return { status: 400 as const, error: "Send the plate reference and the transaction signature." };
  const rows = await sql<{ status: string; chain_ref: string | null; rail: string }>`
    select status, chain_ref, rail from stall_payments where reference = ${reference}`;
  const row = rows[0];
  if (!row || row.rail !== "usdc" || !row.chain_ref) return { status: 404 as const, error: "Unknown plate." };
  if (row.status === "paid") return { status: 200 as const, paid: true };
  const used = await sql<{ reference: string }>`
    select reference from stall_payments where signature = ${signature} and reference <> ${reference}`;
  if (used.length) return { status: 409 as const, error: "That payment was already used." };
  const rpc = opts.rpc || "https://api.mainnet-beta.solana.com";
  let body: { result?: unknown };
  try {
    const res = await (opts.fetchImpl ?? fetch)(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      }),
    });
    body = (await res.json()) as { result?: unknown };
  } catch {
    return { status: 502 as const, error: "The chain could not be read." };
  }
  if (!usdcReceived(body.result, merchant, row.chain_ref))
    return { status: 402 as const, error: "That transaction did not pay 1 USDC for this plate." };
  await sql`
    update stall_payments set status = 'paid', paid_at = now(), signature = ${signature}
    where reference = ${reference} and status = 'pending'`;
  return { status: 200 as const, paid: true };
}
