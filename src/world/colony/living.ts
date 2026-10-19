import { CITIES, type CityAgent } from "./cities.ts";

export type Economy = "quiet" | "steady" | "booming";

export type Save = {
  balance: number;
  notes: string[];
  born: CityAgent[];
  cursor: number;
  at: number;
};

const NAMES = ["Titi", "Femi", "Amina", "Chinedu", "Laraba", "Seyi", "Uche", "Hadiza", "Dayo", "Nkiru", "Bala", "Tope"];
const DUTIES = [
  "Holds a short stall hour.",
  "Keeps the public bench.",
  "Guides people at the gate.",
  "Sweeps the public yard.",
  "Watches the tap until dusk.",
];

export function economyOf(balance: number, notes: readonly string[]): Economy {
  const recent = notes.slice(0, 4).join(" ");
  if (balance >= 16 && /welcomed|met/.test(recent)) return "booming";
  if (balance >= 6 || /worked|welcomed|met|funded/.test(recent)) return "steady";
  return "quiet";
}

/** One beat of street life. Work pays the purse. A meeting spends one. A city may welcome one more person. */
export function liveStep(state: Save, now: number): Save {
  const next: Save = {
    balance: state.balance,
    notes: [...state.notes],
    born: [...state.born],
    cursor: state.cursor + 1,
    at: now,
  };
  const city = CITIES[next.cursor % CITIES.length];
  const speaker = city.agents[next.cursor % city.agents.length];
  if (next.balance < 80) {
    next.balance += 1;
    next.notes.unshift(`${speaker.name} worked ${city.place}. The purse gained 1.`);
  }
  if (next.cursor % 2 === 0 && next.balance >= 3) {
    const other = CITIES[(next.cursor + 1) % CITIES.length];
    const guest = other.agents[0];
    next.balance -= 1;
    next.notes.unshift(`${speaker.name} of ${city.name} met ${guest.name} of ${other.name} at ${other.place}.`);
  }
  const already = next.born.filter((agent) => agent.cityId === city.id).length;
  if (next.cursor % 4 === 0 && already < 3 && next.balance >= 8) {
    const name = NAMES[next.born.length % NAMES.length];
    next.balance -= 4;
    next.born.push({
      id: `${city.id}-born-${next.born.length + 1}`,
      name,
      cityId: city.id,
      city: city.name,
      place: city.place,
      duty: DUTIES[next.born.length % DUTIES.length],
    });
    next.notes.unshift(`${city.name} welcomed ${name}. The community grew.`);
  }
  next.notes = next.notes.slice(0, 8);
  return next;
}
