import type { Sql } from "@/lib/db";
import {
  STALL_MEAL,
  chargePaid,
  checkoutUrl,
  initializeBody,
  mealReferenceOk,
  newMealReference,
  signatureOk,
} from "./till";

type MealUser = { id: string; email: string | null };

export async function openStallMeal(
  sql: Sql,
  user: MealUser,
  opts: { secret: string | undefined; origin: string; fetchImpl?: typeof fetch },
) {
  if (!user.email) return { status: 400 as const, error: "Sign in with an email so the receipt has a name." };
  if (!opts.secret) return { status: 503 as const, error: "The merchant till is not connected yet." };
  const reference = newMealReference();
  await sql`
    insert into stall_payments (reference, user_id, sku, kobo, status)
    values (${reference}, ${user.id}, ${STALL_MEAL.sku}, ${STALL_MEAL.kobo}, 'pending')`;
  const callback = `${opts.origin}/stall/paid?reference=${reference}`;
  let body: unknown;
  try {
    const res = await (opts.fetchImpl ?? fetch)("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { authorization: `Bearer ${opts.secret}`, "content-type": "application/json" },
      body: JSON.stringify(initializeBody(user.email, reference, callback)),
    });
    body = await res.json();
  } catch {
    await sql`update stall_payments set status = 'failed' where reference = ${reference}`;
    return { status: 502 as const, error: "The till could not be reached." };
  }
  const url = checkoutUrl(body as { status?: boolean; data?: { authorization_url?: string; reference?: string } }, reference);
  if (!url) {
    await sql`update stall_payments set status = 'failed' where reference = ${reference}`;
    return { status: 502 as const, error: "The till did not open." };
  }
  return { status: 201 as const, reference, url, kobo: STALL_MEAL.kobo, name: STALL_MEAL.name };
}

export async function readStallMeal(
  sql: Sql,
  reference: string,
  opts: { secret: string | undefined; fetchImpl?: typeof fetch },
) {
  if (!mealReferenceOk(reference)) return { status: 404 as const, error: "Unknown plate." };
  const rows = await sql<{ status: string }>`select status from stall_payments where reference = ${reference}`;
  if (!rows.length) return { status: 404 as const, error: "Unknown plate." };
  if (rows[0].status === "paid") return { status: 200 as const, paid: true, kobo: STALL_MEAL.kobo };
  if (!opts.secret) return { status: 200 as const, paid: false };
  let body: unknown;
  try {
    const res = await (opts.fetchImpl ?? fetch)(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { authorization: `Bearer ${opts.secret}` } },
    );
    body = await res.json();
  } catch {
    return { status: 200 as const, paid: false };
  }
  const data = (body as { status?: boolean; data?: { status?: string; amount?: number; currency?: string } })?.data;
  const ok =
    (body as { status?: boolean }).status === true &&
    data?.status === "success" &&
    data.amount === STALL_MEAL.kobo &&
    data.currency === STALL_MEAL.currency;
  if (!ok) return { status: 200 as const, paid: false };
  await sql`update stall_payments set status = 'paid', paid_at = now() where reference = ${reference} and status = 'pending'`;
  return { status: 200 as const, paid: true, kobo: STALL_MEAL.kobo };
}

export async function takeStallWebhook(sql: Sql, secret: string | undefined, raw: string, signature: string | null) {
  if (!signatureOk(secret ?? "", raw, signature)) return { status: 401 as const, error: "Bad signature." };
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400 as const, error: "Bad payload." };
  }
  const reference = (event as { data?: { reference?: string } }).data?.reference ?? "";
  if (!mealReferenceOk(reference) || !chargePaid(event, reference)) return { status: 200 as const, paid: false };
  await sql`update stall_payments set status = 'paid', paid_at = now() where reference = ${reference} and status = 'pending'`;
  return { status: 200 as const, paid: true };
}
