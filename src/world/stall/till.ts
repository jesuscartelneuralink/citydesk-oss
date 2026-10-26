import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The one plate the operator approved. ₦1,500. The payer cannot change it. */
export const STALL_MEAL = {
  sku: "stall-meal",
  name: "A plate at the public stall",
  kobo: 150_000,
  currency: "NGN",
} as const;

export function newMealReference(): string {
  return `meal_${randomBytes(12).toString("hex")}`;
}

export function mealReferenceOk(reference: string): boolean {
  return /^meal_[0-9a-f]{24}$/.test(reference);
}

export function initializeBody(email: string, reference: string, callbackUrl: string) {
  return {
    email,
    amount: STALL_MEAL.kobo,
    reference,
    currency: STALL_MEAL.currency,
    callback_url: callbackUrl,
    metadata: { sku: STALL_MEAL.sku },
  };
}

export function signPaystack(secret: string, raw: string): string {
  return createHmac("sha512", secret).update(raw).digest("hex");
}

export function signatureOk(secret: string, raw: string, header: string | null): boolean {
  if (!secret || !header || !/^[0-9a-f]{128}$/.test(header)) return false;
  const got = Buffer.from(header, "utf8");
  const expected = Buffer.from(signPaystack(secret, raw), "utf8");
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

type InitResponse = {
  status?: boolean;
  data?: { authorization_url?: string; reference?: string };
};

export function checkoutUrl(body: InitResponse, reference: string): string | null {
  const url = body.data?.authorization_url;
  if (!body.status || !url || !url.startsWith("https://")) return null;
  if (body.data?.reference && body.data.reference !== reference) return null;
  return url;
}

export function chargePaid(event: unknown, reference: string): boolean {
  if (!event || typeof event !== "object") return false;
  const row = event as {
    event?: string;
    data?: { reference?: string; amount?: number; status?: string; currency?: string };
  };
  return (
    row.event === "charge.success" &&
    row.data?.status === "success" &&
    row.data.reference === reference &&
    row.data.amount === STALL_MEAL.kobo &&
    row.data.currency === STALL_MEAL.currency
  );
}

/** A confirmed plate fills hunger. An unpaid plate changes nothing. */
export function hungerAfterPlate(hunger: number, paid: boolean): number {
  if (!paid) return hunger;
  return 100;
}
