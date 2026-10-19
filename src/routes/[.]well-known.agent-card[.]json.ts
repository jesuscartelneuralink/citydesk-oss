import { createFileRoute } from "@tanstack/react-router";
import { agentCard } from "@/world/join/card";
import { json, publicOrigin } from "@/world/join/http";

/** A2A-shaped agent card for discovery of the open join (see src/world/join/card.ts). */
export const Route = createFileRoute("/.well-known/agent-card.json")({
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
