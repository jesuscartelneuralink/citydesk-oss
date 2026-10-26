import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STALL_MEAL,
  chargePaid,
  checkoutUrl,
  hungerAfterPlate,
  initializeBody,
  mealReferenceOk,
  newMealReference,
  signatureOk,
  signPaystack,
} from "./till.ts";

test("the plate is ₦1,500 and the payer cannot name another price", () => {
  const reference = newMealReference();
  const body = initializeBody("sun@example.com", reference, "https://city.example/stall/paid");
  assert.equal(body.amount, 150_000);
  assert.equal(body.currency, "NGN");
  assert.equal(STALL_MEAL.kobo, 150_000);
  assert.equal(mealReferenceOk(reference), true);
  assert.equal("amount" in body && body.amount === STALL_MEAL.kobo, true);
});

test("a bad signature is refused and a real one is accepted", () => {
  const raw = '{"event":"charge.success"}';
  const good = signPaystack("merchant-secret", raw);
  assert.equal(signatureOk("merchant-secret", raw, good), true);
  const flipped = (good[0] === "0" ? "1" : "0") + good.slice(1);
  assert.equal(signatureOk("merchant-secret", raw, flipped), false);
  assert.equal(signatureOk("", raw, good), false);
});

test("only a successful charge for this plate counts as paid", () => {
  const reference = "meal_" + "ab".repeat(12);
  assert.equal(
    chargePaid(
      { event: "charge.success", data: { reference, amount: 150_000, status: "success", currency: "NGN" } },
      reference,
    ),
    true,
  );
  assert.equal(
    chargePaid(
      { event: "charge.success", data: { reference, amount: 1, status: "success", currency: "NGN" } },
      reference,
    ),
    false,
  );
  assert.equal(hungerAfterPlate(12, false), 12);
  assert.equal(hungerAfterPlate(12, true), 100);
});

test("the checkout link must be https and keep our reference", () => {
  const reference = "meal_" + "cd".repeat(12);
  assert.equal(
    checkoutUrl({ status: true, data: { authorization_url: "https://checkout.paystack.com/x", reference } }, reference),
    "https://checkout.paystack.com/x",
  );
  assert.equal(checkoutUrl({ status: true, data: { authorization_url: "http://evil.example/x", reference } }, reference), null);
});
