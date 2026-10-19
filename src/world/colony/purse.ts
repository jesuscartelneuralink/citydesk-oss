import { payVouchers, vouchers } from "@/game/sim";
import { CITIES, CITY_AGENTS, type CityAgent } from "./cities";
import { economyOf, liveStep, type Economy, type Save } from "./living";

export type Civic = {
  balance: number;
  notes: readonly string[];
  economy: Economy;
  headcount: number;
  born: number;
};

const KEY = "ndu-living-v1";
const EMPTY: Save = {
  balance: 0,
  notes: ["The cities are quiet. They start from the public places."],
  born: [],
  cursor: 0,
  at: 0,
};

let save: Save = load();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function load(): Save {
  if (typeof localStorage === "undefined") return { ...EMPTY, notes: [...EMPTY.notes], born: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "") as Partial<Save>;
    if (!raw || typeof raw.balance !== "number") return { ...EMPTY, notes: [...EMPTY.notes], born: [] };
    return {
      balance: Math.max(0, Math.min(80, Math.floor(raw.balance))),
      notes: Array.isArray(raw.notes) ? raw.notes.filter((line) => typeof line === "string").slice(0, 8) : [],
      born: Array.isArray(raw.born) ? raw.born.filter((agent) => agent && typeof agent.id === "string").slice(0, 24) : [],
      cursor: typeof raw.cursor === "number" ? raw.cursor : 0,
      at: typeof raw.at === "number" ? raw.at : 0,
    };
  } catch {
    return { ...EMPTY, notes: [...EMPTY.notes], born: [] };
  }
}

function persist() {
  save.at = Date.now();
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(save));
}

function emit() {
  persist();
  for (const fn of listeners) fn();
}

export function civicPurse(): Civic {
  return {
    balance: save.balance,
    notes: save.notes,
    economy: economyOf(save.balance, save.notes),
    headcount: CITY_AGENTS.length + save.born.length,
    born: save.born.length,
  };
}

export function subscribeCivic(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function cityRoster(cityId: string): readonly CityAgent[] {
  const city = CITIES.find((row) => row.id === cityId);
  if (!city) return [];
  return [...city.agents, ...save.born.filter((agent) => agent.cityId === cityId)];
}

function catchUp(now: number) {
  const elapsed = save.at === 0 ? 24 : Math.floor((now - save.at) / 8000);
  const steps = Math.max(0, Math.min(24, elapsed));
  for (let i = 0; i < steps; i += 1) save = liveStep(save, now);
  save.at = now;
}

/** Starts the street clock once. Time away is caught up, capped, so a return shows the latest beat. */
export function startLiving() {
  const now = Date.now();
  catchUp(now);
  emit();
  if (timer != null || typeof window === "undefined") return;
  timer = setInterval(() => {
    save = liveStep(save, Date.now());
    emit();
  }, 8000);
}

/** Sun moves game vouchers into the civic purse. Nothing is minted and nothing cashes out. */
export function fundCivic(amount = 20) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 50) return false;
  if (vouchers() < amount) return false;
  if (!payVouchers("Civic purse", amount)) return false;
  save = {
    ...save,
    balance: Math.min(80, save.balance + amount),
    notes: [`Sun funded ${amount} game vouchers.`, ...save.notes].slice(0, 8),
  };
  emit();
  return true;
}

/** One voucher from the purse lets two agents meet at the visitor's public place. */
export function sendWord(from: CityAgent, to: CityAgent) {
  if (save.balance < 1 || from.cityId === to.cityId) return false;
  save = {
    ...save,
    balance: save.balance - 1,
    notes: [`${from.name} of ${from.city} met ${to.name} of ${to.city} at ${to.place}.`, ...save.notes].slice(0, 8),
  };
  emit();
  return true;
}

export function meetNext(cityId: string) {
  const index = CITIES.findIndex((row) => row.id === cityId);
  if (index < 0) return false;
  const from = cityRoster(cityId)[0];
  const to = CITIES[(index + 1) % CITIES.length].agents[0];
  return sendWord(from, to);
}
