/**
 * Admin queue for the open join, behind the existing admin login (authMiddleware + the same
 * server-side isAdmin check as the rest of the colony). The client never says who is an admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";

const srv = () => import("./join.server");

async function asCaller(userId: string) {
  const [{ resolveCaller }, { isAdmin }] = await Promise.all([
    import("@/world/colony/work.server"),
    import("@/world/businesses"),
  ]);
  return resolveCaller(await getSql(), userId, isAdmin);
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  const { withStatus } = await import("@/lib/auth/sessions/guard.server");
  return withStatus(fn);
}

export const getJoinQueue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }) =>
    guarded(async () => (await srv()).memberQueue(await getSql(), await asCaller(context.userId))),
  );

export const decideJoinMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; action: string; reason?: string }) => ({
    id: String(input?.id ?? "").slice(0, 40),
    action: String(input?.action ?? "").slice(0, 20),
    reason: String(input?.reason ?? "").slice(0, 300),
  }))
  .handler(({ context, data }) =>
    guarded(async () =>
      (await srv()).decideMember(
        await getSql(),
        await asCaller(context.userId),
        data.id,
        data.action,
        data.reason,
      ),
    ),
  );
