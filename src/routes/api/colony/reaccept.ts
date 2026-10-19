import { createFileRoute } from "@tanstack/react-router";
import { clientIp, errorResponse, json, readJsonBody } from "@/world/join/http";

/** After a creed version bump, a member re-accepts the new creed before acting again. */
export const Route = createFileRoute("/api/colony/reaccept")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const read = await readJsonBody(request, 1024);
        if (!read.ok) return read.response;
        try {
          const [{ getSql }, j] = await Promise.all([
            import("@/lib/db"),
            import("@/world/join/join.server"),
          ]);
          const token = j.bearerToken(request.headers.get("authorization"));
          return json(
            200,
            await j.memberReaccepts(await getSql(), clientIp(request), token, read.body),
          );
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
