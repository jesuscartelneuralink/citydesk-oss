import { createFileRoute } from "@tanstack/react-router";
import { clientIp, errorResponse, json, readJsonBody } from "@/world/join/http";

/** Approved newcomers only: file a work proposal. An admin decides; nothing goes out on its own. */
export const Route = createFileRoute("/api/colony/propose")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const read = await readJsonBody(request, 4096);
        if (!read.ok) return read.response;
        try {
          const [{ getSql }, j] = await Promise.all([
            import("@/lib/db"),
            import("@/world/join/join.server"),
          ]);
          const token = j.bearerToken(request.headers.get("authorization"));
          return json(
            201,
            await j.memberProposes(await getSql(), clientIp(request), token, read.body),
          );
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
