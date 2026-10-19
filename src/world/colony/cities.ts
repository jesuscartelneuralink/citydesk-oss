/** Public places only. A city is a community the agents inhabit, not a private address. */

export type CityAgent = {
  id: string;
  name: string;
  cityId: string;
  city: string;
  place: string;
  duty: string;
};

export type City = {
  id: string;
  name: string;
  place: string;
  agents: readonly CityAgent[];
};

function city(id: string, name: string, place: string, people: readonly [string, string, string][]): City {
  return {
    id,
    name,
    place,
    agents: people.map(([agentId, agentName, duty]) => ({
      id: `${id}-${agentId}`,
      name: agentName,
      cityId: id,
      city: name,
      place,
      duty,
    })),
  };
}

export const CITIES: readonly City[] = [
  city("ph", "Port Harcourt", "The public road", [
    ["kemi", "Kemi", "Drives the keke between public stops."],
    ["ibra", "Ibra", "Drives the bus on the same road."],
    ["sade", "Sade", "Keeps the noon bench."],
  ]),
  city("lagos", "Lagos", "The public market", [
    ["chioma", "Chioma", "Holds a stall hour at the market."],
    ["tunde", "Tunde", "Guides people between the market gates."],
    ["amaka", "Amaka", "Keeps the shade bench by the market."],
  ]),
  city("abuja", "Abuja", "The public park", [
    ["yusuf", "Yusuf", "Walks the park paths in daylight."],
    ["bisi", "Bisi", "Tends the green at the park edge."],
    ["halima", "Halima", "Meets visitors at the park gate."],
  ]),
  city("enugu", "Enugu", "The public station", [
    ["chika", "Chika", "Calls the next public stop."],
    ["emeka", "Emeka", "Keeps the station bench clear."],
    ["ngozi", "Ngozi", "Points people to the right platform."],
  ]),
  city("kano", "Kano", "The public square", [
    ["musa", "Musa", "Sweeps the square at opening."],
    ["zainab", "Zainab", "Runs the water point in the square."],
    ["ibrahim", "Ibrahim", "Repairs the square's shade."],
  ]),
  city("ibadan", "Ibadan", "The public library yard", [
    ["ife", "Ife", "Keeps the yard bench."],
    ["seun", "Seun", "Guides readers to the gate."],
    ["bimpe", "Bimpe", "Watches the yard until dusk."],
  ]),
  city("onitsha", "Onitsha", "The public market", [
    ["obinna", "Obinna", "Holds a counter at the market."],
    ["adaeze", "Adaeze", "Calls the short stall hour."],
    ["nonso", "Nonso", "Keeps the market tap card."],
  ]),
  city("aba", "Aba", "The public workshop yard", [
    ["kelechi", "Kelechi", "Repairs what the yard needs."],
    ["nneka", "Nneka", "Sweeps the workshop gate."],
    ["uzo", "Uzo", "Meets other cities at the gate."],
  ]),
];

export const CITY_AGENTS: readonly CityAgent[] = CITIES.flatMap((row) => row.agents);

export function citiesHold(): boolean {
  const places = new Set(CITIES.map((row) => row.place));
  const ids = new Set<string>();
  if (CITIES.length < 8) return false;
  for (const row of CITIES) {
    if (row.agents.length < 3) return false;
    if (row.place.toLowerCase().includes("home") || row.place.toLowerCase().includes("school")) return false;
    for (const agent of row.agents) {
      if (ids.has(agent.id) || agent.cityId !== row.id) return false;
      ids.add(agent.id);
    }
  }
  return places.size >= 6;
}
