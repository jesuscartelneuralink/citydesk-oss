/** CityDesk is the colony. Sun operates it. Agents live on the street they already have. */

export const OPERATOR = { id: "sun", name: "Sun", role: "operator" as const };

export type Kin = { id: string; name: string; duty: string };

export type Family = {
  id: string;
  name: string;
  place: string;
  kin: readonly Kin[];
  building: string;
};

export type Tribe = {
  id: string;
  name: string;
  place: string;
  families: readonly Family[];
};

export const LAWS = [
  "Sun funds the civic purse. It pays game vouchers only. No coin is minted, and nothing cashes out.",
  "A pin is a public place. Never a house, a school, or a night errand.",
  "One person can finish. A second person is company, not a requirement.",
] as const;

export const COLONY = {
  name: "CityDesk",
  replica: "A replica of the real street, at eye height. One colony. Not a second office.",
  operator: OPERATOR,
  tribes: [
    {
      id: "road",
      name: "Road",
      place: "The public road",
      families: [
        {
          id: "ride",
          name: "Ride",
          place: "The public road",
          kin: [
            { id: "kemi", name: "Kemi", duty: "Drives the keke between public stops." },
            { id: "ibra", name: "Ibra", duty: "Drives the bus on the same road." },
          ],
          building: "Keep the ride on the road. No doorstep pickup.",
        },
      ],
    },
    {
      id: "yard",
      name: "Yard",
      place: "The stall and the standpipe",
      families: [
        {
          id: "hands",
          name: "Hands",
          place: "The food stall",
          kin: [
            { id: "ada", name: "Ada", duty: "Sweeps and takes the short stall hour." },
            { id: "nuru", name: "Nuru", duty: "Repairs what the stall and the tap need." },
          ],
          building: "The short stall, then a meal held at that counter.",
        },
        {
          id: "power",
          name: "Power",
          place: "The standpipe",
          kin: [
            { id: "eko", name: "Eko", duty: "Watches the power." },
            { id: "gba", name: "Gba", duty: "Tends the green by the tap." },
          ],
          building: "The dry-tap card, which vanishes when it is answered.",
        },
      ],
    },
    {
      id: "bench",
      name: "Bench",
      place: "The public bench",
      families: [
        {
          id: "noon",
          name: "Noon",
          place: "The public bench",
          kin: [{ id: "sade", name: "Sade", duty: "Learns the streets and keeps the noon bench." }],
          building: "The noon bench. Daylight. Finishable alone.",
        },
      ],
    },
    {
      id: "makers",
      name: "Makers",
      place: "The council office",
      families: [
        {
          id: "council",
          name: "Council",
          place: "The council office",
          kin: [
            { id: "pane", name: "Pane", duty: "Holds the roster." },
            { id: "warden", name: "Warden", duty: "Keeps the Saturday list in order." },
            { id: "street", name: "Streetwright", duty: "Builds the roads and the figure." },
            { id: "body", name: "Body", duty: "Keeps the walking body honest." },
            { id: "ledger", name: "Ledger", duty: "Keeps vouchers inside the game." },
            { id: "signal", name: "Signal", duty: "Sounds the end of a mission." },
            { id: "gate", name: "Gate", duty: "Keeps the block for adults." },
            { id: "navigator", name: "Navigator", duty: "Keeps left as left and right as right." },
          ],
          building: "Finish this street. Do not open another city.",
        },
      ],
    },
  ] as const satisfies readonly Tribe[],
};

const PUBLIC = new Set(["The public road", "The stall and the standpipe", "The food stall", "The standpipe", "The public bench", "The council office"]);

export function charterHolds(): boolean {
  if (COLONY.operator.name !== "Sun") return false;
  const tribes = COLONY.tribes as readonly Tribe[];
  const seen = new Set<string>();
  for (const tribe of tribes) {
    if (!PUBLIC.has(tribe.place) || tribe.families.length === 0) return false;
    for (const family of tribe.families) {
      if (!PUBLIC.has(family.place) || family.kin.length === 0) return false;
      for (const kin of family.kin) {
        if (seen.has(kin.id)) return false;
        seen.add(kin.id);
      }
    }
  }
  return seen.size > 0;
}
