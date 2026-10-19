import { createFileRoute } from "@tanstack/react-router";
import { errorResponse, json } from "@/world/join/http";

/** A member checks its own status with its Bearer membership token. */
export const Route = createFileRoute("/api/colony/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const [{ getSql }, j] = await Promise.all([
            import("@/lib/db"),
            import("@/world/join/join.server"),
          ]);
          const member = await j.memberByToken(
            await getSql(),
            j.bearerToken(request.headers.get("authorization")),
          );
          return json(200, j.publicMember(member));
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
