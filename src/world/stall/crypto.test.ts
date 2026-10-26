import assert from "node:assert/strict";
import { test } from "node:test";
import { base58Length } from "@/world/colony/addresses";
import { USDC_MINT, merchantOk, newChainRef, payUrl, txSignatureOk, usdcReceived } from "./crypto.ts";

const MERCHANT = "So11111111111111111111111111111111111111112";
const REF = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

test("the crypto plate is 1 USDC to the operator's public address", () => {
  assert.equal(merchantOk(undefined), null);
  assert.equal(merchantOk("not an address"), null);
  assert.equal(merchantOk(USDC_MINT), null);
  assert.equal(merchantOk(MERCHANT), MERCHANT);
  const chainRef = newChainRef();
  assert.equal(base58Length(chainRef), 32);
  const url = payUrl(MERCHANT, chainRef);
  assert.equal(url.startsWith(`solana:${MERCHANT}?`), true);
  assert.match(url, /amount=1/);
  assert.match(url, new RegExp(USDC_MINT));
  assert.match(url, new RegExp(chainRef));
  assert.equal(url.includes("secret"), false);
});

test("a plate is paid only when 1 USDC lands on that reference", () => {
  const tx = {
    meta: {
      err: null,
      preTokenBalances: [{ owner: MERCHANT, mint: USDC_MINT, uiTokenAmount: { amount: "5" } }],
      postTokenBalances: [{ owner: MERCHANT, mint: USDC_MINT, uiTokenAmount: { amount: "1000005" } }],
    },
    transaction: { message: { accountKeys: [{ pubkey: MERCHANT }, { pubkey: REF }] } },
  };
  assert.equal(usdcReceived(tx, MERCHANT, REF), true);
  assert.equal(usdcReceived({ ...tx, meta: { ...tx.meta, err: "failed" } }, MERCHANT, REF), false);
  assert.equal(usdcReceived(tx, MERCHANT, "other"), false);
  const short = {
    ...tx,
    meta: {
      err: null,
      preTokenBalances: tx.meta.preTokenBalances,
      postTokenBalances: [{ owner: MERCHANT, mint: USDC_MINT, uiTokenAmount: { amount: "6" } }],
    },
  };
  assert.equal(usdcReceived(short, MERCHANT, REF), false);
  assert.equal(txSignatureOk("a".repeat(40)), false);
});
