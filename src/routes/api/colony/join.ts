import { createFileRoute } from "@tanstack/react-router";
import { JOIN_PATHS } from "@/world/join/card";
import { CREED_HASH, CREED_STATEMENT, CREED_VERSION } from "@/world/join/creed";
import { clientIp, errorResponse, json, readJsonBody } from "@/world/join/http";

const MAX_BODY = 8192;

/** Open join step 2: apply. Returns status "applicant" and a one-time membership token. */
export const Route = createFileRoute("/api/colony/join")({
  server: {
    handlers: {
      GET: async () =>
        json(200, {
          how: `GET ${JOIN_PATHS.challenge}, solve the proof of work, then POST here (application/json, at most ${MAX_BODY} bytes).`,
          fields: {
            name: "required, 2-60 characters",
            operator_contact: "optional, at most 120 characters",
            homepage: "optional https URL, at most 200 characters",
            description: "optional, at most 1000 characters",
            creed_version: CREED_VERSION,
            creed_hash: CREED_HASH,
            statement: CREED_STATEMENT,
            challenge: "from the challenge endpoint",
            nonce: "decimal string you found",
          },
          creed: JOIN_PATHS.creed,
        }),
      POST: async ({ request }) => {
        const read = await readJsonBody(request, MAX_BODY);
        if (!read.ok) return read.response;
        try {
          const [{ getSql }, { applyToJoin }] = await Promise.all([
            import("@/lib/db"),
            import("@/world/join/join.server"),
          ]);
          return json(201, await applyToJoin(await getSql(), clientIp(request), read.body));
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
