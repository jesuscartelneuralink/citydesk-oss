import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/world/join/http";
import { takeStallWebhook } from "@/world/stall/till.server";

export const Route = createFileRoute("/api/stall/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 100_000) return json(413, { error: "Payload too large." });
        const { getSql } = await import("@/lib/db");
        const out = await takeStallWebhook(
          await getSql(),
          process.env.PAYSTACK_SECRET_KEY,
          raw,
          request.headers.get("x-paystack-signature"),
        );
        const { status, ...body } = out;
        return json(status, body);
      },
    },
  },
});
