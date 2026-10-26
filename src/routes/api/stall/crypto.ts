import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { json, readJsonBody } from "@/world/join/http";
import { confirmStallUsdc, openStallUsdc } from "@/world/stall/crypto.server";

export const Route = createFileRoute("/api/stall/crypto")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return json(401, { error: "Sign in to buy a plate." });
        const read = await readJsonBody(request, 2000);
        if (!read.ok) return read.response;
        const body = (read.body && typeof read.body === "object" ? read.body : {}) as {
          reference?: string;
          signature?: string;
        };
        const { getSql } = await import("@/lib/db");
        const sql = await getSql();
        if (body.signature) {
          const out = await confirmStallUsdc(sql, body, { merchant: process.env.STALL_USDC_ADDRESS });
          const { status, ...rest } = out;
          return json(status, rest);
        }
        const out = await openStallUsdc(sql, user.id, { merchant: process.env.STALL_USDC_ADDRESS });
        const { status, ...rest } = out;
        return json(status, rest);
      },
    },
  },
});
