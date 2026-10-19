/**
 * Server functions for the colony work system. Every one runs authMiddleware (verified session user
 * id), then resolves admin rights SERVER-side with the same check the admin board uses
 * (isAdmin in src/world/businesses.ts: app_admins plus the NDU_ADMIN_* allowlist). Errors with a
 * status (401/403/404/409) become that HTTP status. The client never says who is an admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import type { Chain } from "./addresses";
import type { LedgerSource } from "./ledger";

const srv = () => import("./work.server");

async function asCaller(userId: string) {
  const [{ resolveCaller }, { isAdmin }] = await Promise.all([srv(), import("@/world/businesses")]);
  return resolveCaller(await getSql(), userId, isAdmin);
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  const { withStatus } = await import("@/lib/auth/sessions/guard.server");
  return withStatus(fn);
}

const str = (value: unknown, max: number) => String(value ?? "").slice(0, max);

export const getColonyView = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }) =>
    guarded(async () => (await srv()).colonyView(await getSql(), await asCaller(context.userId))),
  );

export const setColonyWorkSwitch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { on: boolean }) => ({ on: input?.on === true }))
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).setWorkSwitch(await getSql(), await asCaller(context.userId), data.on),
    ),
  );

export const creditColonyCents = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: { citizenId: string; amountCents: number; source?: LedgerSource; ref?: string }) => ({
      citizenId: str(input?.citizenId, 80),
      amountCents: Number(input?.amountCents),
      source: (input?.source ?? "internal") as LedgerSource,
      ref: str(input?.ref, 120),
    }),
  )
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).creditCents(await getSql(), await asCaller(context.userId), data),
    ),
  );

export const clearColonyCredit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: str(input?.id, 80) }))
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).clearCredit(await getSql(), await asCaller(context.userId), data.id),
    ),
  );

export const reverseColonyCredit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: str(input?.id, 80) }))
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).reverseCredit(await getSql(), await asCaller(context.userId), data.id),
    ),
  );

export const addColonyWatchAddress = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { citizenId: string; chain: Chain; address: string }) => ({
    citizenId: str(input?.citizenId, 80),
    chain: str(input?.chain, 20),
    address: str(input?.address, 400),
  }))
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).addWatchAddress(
        await getSql(),
        await asCaller(context.userId),
        data.citizenId,
        data.chain,
        data.address,
      ),
    ),
  );

export const fileColonyProposal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      citizenId: string;
      workId: string;
      job: string;
      payload: string;
      target: string;
      expectedCents: number;
    }) => ({
      citizenId: str(input?.citizenId, 80),
      workId: str(input?.workId, 4),
      job: str(input?.job, 200),
      payload: str(input?.payload, 4000),
      target: str(input?.target, 200),
      expectedCents: Number(input?.expectedCents ?? 0),
    }),
  )
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).fileWorkProposal(await getSql(), await asCaller(context.userId), data),
    ),
  );

export const decideColonyProposal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; status: "approved" | "refused" }) => ({
    id: str(input?.id, 120),
    status: input?.status === "approved" ? "approved" : "refused",
  }))
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).decideProposal(
        await getSql(),
        await asCaller(context.userId),
        data.id,
        data.status,
      ),
    ),
  );
