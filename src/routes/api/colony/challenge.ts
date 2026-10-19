import { createFileRoute } from "@tanstack/react-router";
import { clientIp, errorResponse, json } from "@/world/join/http";

/** Open join step 1: a single-use sha256 proof-of-work challenge. Rate limited per IP and globally. */
export const Route = createFileRoute("/api/colony/challenge")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const [{ getSql }, { issueChallenge }] = await Promise.all([
            import("@/lib/db"),
            import("@/world/join/join.server"),
          ]);
          return json(200, await issueChallenge(await getSql(), clientIp(request)));
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
