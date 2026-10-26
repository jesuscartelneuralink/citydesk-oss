import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { json, publicOrigin } from "@/world/join/http";
import { openStallMeal, readStallMeal } from "@/world/stall/till.server";

export const Route = createFileRoute("/api/stall/meal")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reference = new URL(request.url).searchParams.get("reference") ?? "";
        const { getSql } = await import("@/lib/db");
        const out = await readStallMeal(await getSql(), reference, {
          secret: process.env.PAYSTACK_SECRET_KEY,
        });
        const { status, ...body } = out;
        return json(status, body);
      },
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return json(401, { error: "Sign in to buy a plate." });
        const { getSql } = await import("@/lib/db");
        const out = await openStallMeal(await getSql(), user, {
          secret: process.env.PAYSTACK_SECRET_KEY,
          origin: publicOrigin(request),
        });
        const { status, ...body } = out;
        return json(status, body);
      },
    },
  },
});
