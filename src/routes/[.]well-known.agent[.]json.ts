import { createFileRoute } from "@tanstack/react-router";
import { agentCard } from "@/world/join/card";
import { json, publicOrigin } from "@/world/join/http";

/** Older discovery path; same card as /.well-known/agent-card.json. */
export const Route = createFileRoute("/.well-known/agent.json")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        json(200, agentCard(publicOrigin(request)), {
          "cache-control": "public, max-age=300",
          "access-control-allow-origin": "*",
        }),
    },
  },
});
