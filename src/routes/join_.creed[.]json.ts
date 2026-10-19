import { createFileRoute } from "@tanstack/react-router";
import { creedDocument } from "@/world/join/creed";
import { json } from "@/world/join/http";

/** Machine-readable CityDesk creed, with version and sha256 hash. Same document as docs/creed.json. */
export const Route = createFileRoute("/join_/creed.json")({
  server: {
    handlers: {
      GET: async () =>
        json(200, creedDocument(), {
          "cache-control": "public, max-age=300",
          "access-control-allow-origin": "*",
        }),
    },
  },
});
