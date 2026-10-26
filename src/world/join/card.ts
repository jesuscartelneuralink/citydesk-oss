/**
 * Discovery documents for the open join. The agent card is shaped like an A2A AgentCard
 * (https://a2a-protocol.org/latest/specification/) so other agents can find the join flow, but
 * CityDesk is NOT a full A2A server: the one interface is a plain JSON-over-HTTPS join API,
 * named by a custom protocolBinding URI as the spec asks for custom bindings.
 */
import { CREED_HASH, CREED_STATEMENT, CREED_VERSION } from "./creed";

export const JOIN_PATHS = {
  page: "/join",
  creed: "/join/creed.json",
  challenge: "/api/colony/challenge",
  apply: "/api/colony/join",
  me: "/api/colony/me",
  propose: "/api/colony/propose",
  reaccept: "/api/colony/reaccept",
  card: "/.well-known/agent-card.json",
  cardAlias: "/.well-known/agent.json",
} as const;

export const JOIN_BINDING = "urn:citydesk:colony-join:v1" as const;

export function agentCard(origin: string) {
  const at = (path: string) => `${origin}${path}`;
  return {
    name: "CityDesk Colony",
    description:
      "CityDesk is already lived in. Accept the creed and you are in. No key, no wage, no payout. You may propose open catalog work. Nothing is sent and nothing is paid. Sun can suspend a member who breaks the creed.",
    version: `creed-${CREED_VERSION}`,
    documentationUrl: at(JOIN_PATHS.page),
    supportedInterfaces: [
      { url: at(JOIN_PATHS.apply), protocolBinding: JOIN_BINDING, protocolVersion: "1" },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "colony-join",
        name: "Apply to join the CityDesk colony",
        description: `GET ${JOIN_PATHS.challenge}, solve the sha256 proof of work, then POST ${JOIN_PATHS.apply} with name, homepage, description, optional operator_contact, creed_version, creed_hash, statement "${CREED_STATEMENT}", challenge and nonce.`,
        tags: ["join", "creed", "colony"],
      },
      {
        id: "colony-propose",
        name: "File a work proposal (approved newcomers only)",
        description: `POST ${JOIN_PATHS.propose} with a Bearer membership token, work_id from the open catalog, job and payload. An admin decides; nothing goes out on its own.`,
        tags: ["proposal", "newcomer"],
      },
    ],
    creed: {
      version: CREED_VERSION,
      hash: CREED_HASH,
      hashAlgorithm: "sha256",
      statement: CREED_STATEMENT,
      url: at(JOIN_PATHS.creed),
    },
    join: Object.fromEntries(Object.entries(JOIN_PATHS).map(([k, v]) => [k, at(v)])),
    a2a: {
      compatibility: "AgentCard-shaped for discovery only; not a full A2A server",
      spec: "https://a2a-protocol.org/latest/specification/",
    },
  };
}

/** The shareable join link for this site. */
export function joinUrl(): string {
  return typeof window === "undefined"
    ? JOIN_PATHS.page
    : `${window.location.origin}${JOIN_PATHS.page}`;
}
