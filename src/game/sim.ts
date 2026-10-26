import { LINES } from "./copy";
import { chime, unlockChime } from "./chime";
import { readAgeOk, writeAgeOk } from "./ageOk";
import { freshSeen, MISSIONS, stepCleared, type Seen } from "./missions";
import {
  bench,
  buildings,
  fanSpot,
  neighbor,
  PLAYER_R,
  shopDoor,
  stall,
  tap,
  WALK,
  WORLD,
} from "./layout";

export type NeedKey = "hunger" | "energy" | "hygiene" | "social" | "comfort" | "health";

export type LedgerEntry = {
  id: string;
  label: string;
  delta: number;
  minute: number;
};

export type JobPhase = "none" | "accepted" | "working" | "done";
export type Near = "stall" | "shop" | "fan" | "bench" | "tap" | "neighbor" | null;
export type PhoneTab = "life" | "jobs" | "wallet" | "studio" | null;

export type Sim = {
  phase: "gate" | "play";
  ageOk: boolean;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  needs: Record<NeedKey, number>;
  ledger: LedgerEntry[];
  gameMinutes: number;
  nepa: boolean;
  highRoad: boolean;
  phone: PhoneTab;
  job: JobPhase;
  jobTime: number;
  near: Near;
  toast: string;
  toastUntil: number;
  elapsed: number;
  rentTold: boolean;
  interactHeld: boolean;
  fanUntil: number;
  lineCursor: number;
  missionIndex: number;
  missionStep: number;
  seen: Seen;
  dest: { x: number; z: number; name: string; inside: "shop" | "hall" | null } | null;
  interior: "shop" | "hall" | null;
  ownsRoom: boolean;
};

const DECAY: Record<NeedKey, number> = {
  hunger: 0.12,
  energy: 0.08,
  hygiene: 0.06,
  social: 0.05,
  comfort: 0.07,
  health: 0.03,
};

export const NEED_KEYS = Object.keys(DECAY) as NeedKey[];

export function createSim(): Sim {
  return {
    phase: "gate",
    ageOk: false,
    x: 0,
    z: 16,
    yaw: 0,
    speed: 0,
    needs: { hunger: 65, energy: 80, hygiene: 75, social: 70, comfort: 75, health: 90 },
    ledger: [{ id: "welcome", label: "Welcome allocation", delta: 50, minute: 0 }],
    gameMinutes: 0,
    nepa: true,
    highRoad: false,
    phone: null,
    job: "none",
    jobTime: 0,
    near: null,
    toast: "",
    toastUntil: 0,
    elapsed: 0,
    rentTold: false,
    interactHeld: false,
    fanUntil: 0,
    lineCursor: 0,
    missionIndex: 0,
    missionStep: 0,
    seen: freshSeen(),
    dest: null,
    interior: null,
    ownsRoom: false,
  };
}

export const sim = createSim();

const NEEDS_KEY = "ndu-needs";
let lifePaused = false;
let needsSavedAt = -1;

function clampNeed(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function persistNeeds() {
  if (typeof localStorage === "undefined") return;
  const snapshot: Record<NeedKey, number> = {
    hunger: clampNeed(sim.needs.hunger),
    energy: clampNeed(sim.needs.energy),
    hygiene: clampNeed(sim.needs.hygiene),
    social: clampNeed(sim.needs.social),
    comfort: clampNeed(sim.needs.comfort),
    health: clampNeed(sim.needs.health),
  };
  for (const key of NEED_KEYS) sim.needs[key] = snapshot[key];
  try {
    localStorage.setItem(NEEDS_KEY, JSON.stringify(snapshot));
  } catch {
    /* a blocked store must not break the street */
  }
}

function restoreNeeds() {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(NEEDS_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const obj = parsed as Record<string, unknown>;
    if (!NEED_KEYS.every((key) => Object.prototype.hasOwnProperty.call(obj, key))) return;
    const next = {} as Record<NeedKey, number>;
    for (const key of NEED_KEYS) {
      const value = obj[key];
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      next[key] = clampNeed(value);
    }
    for (const key of NEED_KEYS) sim.needs[key] = next[key];
    persistNeeds();
  } catch {
    /* ignore bad JSON */
  }
}

restoreNeeds();
restoreAge();

const listeners = new Set<() => void>();

export function subscribeSim(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitSim() {
  for (const fn of listeners) fn();
}

export function vouchers(s: Sim = sim) {
  return s.ledger.reduce((sum, row) => sum + row.delta, 0);
}

export function rentDue(s: Sim = sim) {
  return s.gameMinutes >= 60;
}

export function clockLabel(s: Sim = sim) {
  const total = 8 * 60 + Math.floor(s.gameMinutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `Saturday ${hh}:${mm}`;
}

function say(s: Sim, text: string) {
  s.toast = text;
  s.toastUntil = s.elapsed + 4.5;
}

function advanceMission() {
  let guard = 0;
  while (sim.missionIndex < MISSIONS.length && guard < 24) {
    const mission = MISSIONS[sim.missionIndex];
    if (!mission || sim.missionStep >= mission.steps.length) {
      sim.missionIndex += 1;
      sim.missionStep = 0;
      guard += 1;
      continue;
    }
    if (!stepCleared(sim, sim.missionIndex, sim.missionStep)) return;
    sim.missionStep += 1;
    if (sim.missionStep >= mission.steps.length) {
      sim.missionIndex += 1;
      sim.missionStep = 0;
      const next = MISSIONS[sim.missionIndex];
      chime("done");
      say(sim, next ? `${mission.title} complete. ${next.brief}` : "The Saturday list is done.");
    }
    guard += 1;
  }
}

export function earnVouchers(label: string, amount: number) {
  if (amount <= 0) return false;
  if (label === "Walk") {
    const earned = sim.ledger.reduce((sum, row) => sum + (row.label === "Walk" ? Math.max(0, row.delta) : 0), 0);
    if (earned >= 20) return false;
  }
  pushLedger(sim, label, amount);
  if (label === "Walk") say(sim, `Walked the road. +${amount} game voucher.`);
  else if (label === "Ride back") say(sim, `The ride vouchers were returned. +${amount} game voucher.`);
  else say(sim, `+${amount} game voucher. ${label}.`);
  emitSim();
  return true;
}

export function payVouchers(label: string, cost: number) {
  if (cost <= 0 || vouchers(sim) < cost) {
    say(sim, "Not enough game vouchers.");
    emitSim();
    return false;
  }
  pushLedger(sim, label, -cost);
  emitSim();
  return true;
}

function pushLedger(s: Sim, label: string, delta: number) {
  s.ledger = [
    ...s.ledger,
    { id: `${label}-${s.ledger.length}`, label, delta, minute: Math.floor(s.gameMinutes) },
  ];
}

function dist(x: number, z: number, p: { x: number; z: number }) {
  return Math.hypot(x - p.x, z - p.z);
}

export function resolve(x: number, z: number, radius = PLAYER_R) {
  let px = x;
  let pz = z;
  const boxes = buildings;
  for (let n = 0; n < 2; n++) {
    for (const b of boxes) {
      const cx = Math.min(Math.max(px, b.minX), b.maxX);
      const cz = Math.min(Math.max(pz, b.minZ), b.maxZ);
      let dx = px - cx;
      let dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          px += (dx / d) * (radius - d);
          pz += (dz / d) * (radius - d);
        } else {
          const left = px - b.minX;
          const right = b.maxX - px;
          const down = pz - b.minZ;
          const up = b.maxZ - pz;
          const m = Math.min(left, right, down, up);
          if (m === left) px = b.minX - radius;
          else if (m === right) px = b.maxX + radius;
          else if (m === down) pz = b.minZ - radius;
          else pz = b.maxZ + radius;
        }
      }
    }
  }
  px = Math.min(Math.max(px, WORLD.minX + radius), WORLD.maxX - radius);
  pz = Math.min(Math.max(pz, WORLD.minZ + radius), WORLD.maxZ - radius);
  return { x: px, z: pz };
}

export type Basis = { fx: number; fz: number; rx: number; rz: number };

export function stepSim(dt: number, basis: Basis, move: { x: number; y: number }) {
  const s = sim;
  if (s.phase !== "play" || s.phone || s.interior) {
    s.speed = 0;
    return;
  }
  s.elapsed += dt;
  if (s.toast && s.elapsed > s.toastUntil) s.toast = "";
  if (!lifePaused) {
    s.gameMinutes += dt;
    if (!s.rentTold && rentDue(s)) {
      s.rentTold = true;
      say(s, LINES.rent);
    }
    for (const key of NEED_KEYS) {
      s.needs[key] = Math.min(100, Math.max(0, s.needs[key] - DECAY[key] * dt));
    }
    const mark = Math.floor(s.elapsed);
    if (mark !== needsSavedAt) {
      needsSavedAt = mark;
      persistNeeds();
    }
  }

  const { fx, fz, rx, rz } = basis;
  const vx = rx * move.x + fx * move.y;
  const vz = rz * move.x + fz * move.y;
  const mag = Math.hypot(vx, vz);
  if (mag > 1e-4) {
    s.dest = null;
    const nx = vx / mag;
    const nz = vz / mag;
    const next = resolve(s.x + nx * WALK * dt, s.z + nz * WALK * dt);
    const moved = Math.hypot(next.x - s.x, next.z - s.z);
    s.x = next.x;
    s.z = next.z;
    s.speed = moved / dt;
    s.yaw = Math.atan2(-nx, -nz);
  } else if (s.dest) {
    const dx = s.dest.x - s.x;
    const dz = s.dest.z - s.z;
    const distLeft = Math.hypot(dx, dz);
    if (distLeft < 1.15) {
      const arrived = s.dest;
      s.dest = null;
      s.speed = 0;
      if (arrived.inside) s.interior = arrived.inside;
      say(s, arrived.inside ? `You step into ${arrived.name}.` : `You are at ${arrived.name}.`);
    } else {
      const nx = dx / distLeft;
      const nz = dz / distLeft;
      const next = resolve(s.x + nx * WALK * dt, s.z + nz * WALK * dt);
      const moved = Math.hypot(next.x - s.x, next.z - s.z);
      s.x = next.x;
      s.z = next.z;
      s.speed = moved / dt;
      s.yaw = Math.atan2(-nx, -nz);
    }
  } else {
    s.speed = 0;
  }

  const spots = [
    { id: "stall" as const, p: stall, flag: "stall" as const },
    { id: "shop" as const, p: shopDoor, flag: null },
    { id: "fan" as const, p: fanSpot, flag: null },
    { id: "bench" as const, p: bench, flag: "bench" as const },
    { id: "tap" as const, p: tap, flag: "tap" as const },
    { id: "neighbor" as const, p: neighbor, flag: "neighbor" as const },
  ];
  let best: (typeof spots)[number] | null = null;
  let bestD = Infinity;
  for (const spot of spots) {
    const d = dist(s.x, s.z, spot.p);
    if (d <= spot.p.r && d < bestD) {
      best = spot;
      bestD = d;
    }
  }
  s.near = best ? best.id : null;
  if (best?.flag) s.seen[best.flag] = true;

  if (s.highRoad && s.nepa) s.seen.lamps = true;

  if (s.job === "working") {
    if (dist(s.x, s.z, shopDoor) <= shopDoor.r + 0.4) {
      s.jobTime += dt;
      if (s.jobTime >= 20) {
        s.job = "done";
        pushLedger(s, "Shop assistant shift", 30);
        say(s, LINES.shiftDone);
      }
    }
  }
  advanceMission();
}

/** A plate already paid in naira at the public stall. */
export function eatPaidPlate(s: Sim = sim) {
  s.needs.hunger = 100;
  say(s, "The plate is paid. Eat.");
}

export function tryInteract() {
  const s = sim;
  if (s.phase !== "play" || s.phone) return;
  if (s.near === "stall") {
    if (vouchers(s) < 10) {
      say(s, LINES.broke);
    } else {
      pushLedger(s, "Food stall", -10);
      s.needs.hunger = Math.min(100, s.needs.hunger + 30);
      say(s, LINES.stall[s.lineCursor % LINES.stall.length]);
      s.lineCursor += 1;
    }
  } else if (s.near === "shop") {
    if (s.job === "none") say(s, "Open Jobs on the phone and take the shift first.");
    else if (s.job === "accepted") {
      s.job = "working";
      s.jobTime = 0;
      say(s, LINES.shop[0]);
    } else if (s.job === "working") say(s, LINES.shop[1]);
    else say(s, LINES.shiftDone);
  } else if (s.near === "fan") {
    if (!s.nepa) say(s, LINES.fanDead);
    else {
      s.fanUntil = s.elapsed + 2.4;
      s.seen.fanSpun = true;
      chime("act");
      say(s, LINES.fanOn);
    }
  } else if (s.near === "bench") {
    s.needs.energy = Math.min(100, s.needs.energy + 25);
    s.seen.rested = true;
    chime("act");
    say(s, "You sit. The noise of the road drops.");
  } else if (s.near === "tap") {
    s.needs.hygiene = Math.min(100, s.needs.hygiene + 25);
    s.seen.washed = true;
    chime("act");
    say(s, "The standpipe runs. You wash.");
  } else if (s.near === "neighbor") {
    s.needs.social = Math.min(100, s.needs.social + 20);
    s.seen.greeted = true;
    chime("act");
    say(s, "They nod. The street knows you are here.");
  }
  advanceMission();
  persistNeeds();
  emitSim();
}

export function shareMeal(from: string) {
  const s = sim;
  if (s.phase !== "play") return;
  s.needs.hunger = Math.min(100, s.needs.hunger + 14);
  say(s, `${from} shared a meal. Game food only.`);
  persistNeeds();
  emitSim();
}

export function drinkFromHome(item: string) {
  const s = sim;
  if (s.phase !== "play") return;
  const name = item.slice(0, 24);
  s.needs.hunger = Math.min(100, s.needs.hunger + (name === "Water" ? 8 : 16));
  say(s, `You take ${name} from the fridge.`);
  persistNeeds();
  emitSim();
}

export function setLifePaused(paused: boolean): void {
  lifePaused = paused;
}

export function tickLife(dt: number) {
  const s = sim;
  if (s.phase !== "play") return;
  if (lifePaused) {
    if (s.toast && s.elapsed > s.toastUntil) {
      s.toast = "";
      emitSim();
    }
    return;
  }
  s.elapsed += dt;
  s.gameMinutes += dt;
  if (s.toast && s.elapsed > s.toastUntil) s.toast = "";
  if (!s.rentTold && rentDue(s)) {
    s.rentTold = true;
    say(s, LINES.rent);
  }
  for (const key of NEED_KEYS) {
    s.needs[key] = Math.min(100, Math.max(0, s.needs[key] - DECAY[key] * dt));
  }
  persistNeeds();
  emitSim();
}

export function liveAct(kind: "eat" | "shift" | "rest" | "wash" | "greet" | "care", place: string) {
  const s = sim;
  if (s.phase !== "play") return;
  if (kind === "eat") {
    if (vouchers(s) < 10) say(s, LINES.broke);
    else {
      pushLedger(s, "Food stall", -10);
      s.needs.hunger = Math.min(100, s.needs.hunger + 34);
      s.seen.stall = true;
      chime("act");
      say(s, `You eat at ${place}.`);
    }
  } else if (kind === "shift") {
    pushLedger(s, `${place} shift`, 30);
    s.needs.energy = Math.max(0, s.needs.energy - 12);
    s.job = "done";
    chime("done");
    say(s, `Shift done at ${place}.`);
  } else if (kind === "rest") {
    s.needs.energy = Math.min(100, s.needs.energy + 22);
    s.needs.comfort = Math.min(100, s.needs.comfort + 16);
    s.seen.rested = true;
    chime("act");
    say(s, `You rest at ${place}.`);
  } else if (kind === "wash") {
    s.needs.hygiene = Math.min(100, s.needs.hygiene + 28);
    s.seen.washed = true;
    chime("act");
    say(s, `You wash at ${place}.`);
  } else if (kind === "greet") {
    s.needs.social = Math.min(100, s.needs.social + 22);
    s.seen.greeted = true;
    chime("act");
    say(s, place);
  } else {
    s.needs.health = Math.min(100, s.needs.health + 20);
    chime("act");
    say(s, `You stop at ${place}.`);
  }
  advanceMission();
  persistNeeds();
  emitSim();
}

export function setDestination(dest: { x: number; z: number; name: string; inside: "shop" | "hall" | null }) {
  if (sim.phase !== "play") return;
  sim.dest = dest;
  sim.interior = null;
  sim.phone = null;
  say(sim, `Heading to ${dest.name}.`);
  emitSim();
}

export function leaveInterior() {
  sim.interior = null;
  emitSim();
}

export function buyGood(kind: "bread" | "water" | "soap" | "drink") {
  const s = sim;
  const goods = {
    bread: { cost: 8, label: "Bread", hunger: 22, hygiene: 0, social: 0, comfort: 0, health: 0 },
    water: { cost: 4, label: "Water", hunger: 6, hygiene: 0, social: 0, comfort: 4, health: 10 },
    soap: { cost: 6, label: "Soap", hunger: 0, hygiene: 20, social: 0, comfort: 4, health: 0 },
    drink: { cost: 12, label: "Hall drink", hunger: 0, hygiene: 0, social: 16, comfort: 8, health: 0 },
  }[kind];
  if (vouchers(s) < goods.cost) {
    say(s, LINES.broke);
  } else {
    pushLedger(s, goods.label, -goods.cost);
    s.needs.hunger = Math.min(100, s.needs.hunger + goods.hunger);
    s.needs.hygiene = Math.min(100, s.needs.hygiene + goods.hygiene);
    s.needs.social = Math.min(100, s.needs.social + goods.social);
    s.needs.comfort = Math.min(100, s.needs.comfort + goods.comfort);
    s.needs.health = Math.min(100, s.needs.health + goods.health);
    chime("act");
    say(s, `You take the ${goods.label.toLowerCase()}.`);
    persistNeeds();
  }
  emitSim();
}

export function buyRoom() {
  const s = sim;
  if (s.ownsRoom) {
    say(s, "You already keep a room on Bonny.");
  } else if (vouchers(s) < 80) {
    say(s, LINES.broke);
  } else {
    pushLedger(s, "Room on Bonny", -80);
    s.ownsRoom = true;
    s.needs.comfort = Math.min(100, s.needs.comfort + 20);
    chime("done");
    say(s, "The room is yours. Game vouchers only. Nothing leaves this street.");
    persistNeeds();
  }
  emitSim();
}

export function acceptJob() {
  if (sim.job === "none") {
    sim.job = "accepted";
    say(sim, "Shop assistant shift is yours. Walk to the shop.");
    advanceMission();
    emitSim();
  }
}

export function toggleNepa() {
  sim.nepa = !sim.nepa;
  if (!sim.nepa) sim.seen.nepaOff = true;
  else if (sim.seen.nepaOff) sim.seen.nepaBack = true;
  if (sim.highRoad && sim.nepa) sim.seen.lamps = true;
  say(sim, sim.nepa ? LINES.nepaOn : LINES.nepaOff);
  advanceMission();
  emitSim();
}

export function toggleHighRoad() {
  sim.highRoad = !sim.highRoad;
  if (sim.highRoad && sim.nepa) {
    sim.seen.lamps = true;
    say(sim, LINES.highRoad);
  } else if (sim.highRoad) say(sim, "The High Road switch is on. Lamps still need NEPA.");
  advanceMission();
  emitSim();
}

export function setPhone(tab: PhoneTab) {
  sim.phone = sim.phone === tab ? null : tab;
  sim.speed = 0;
  emitSim();
}

export function enterBlock() {
  if (!sim.ageOk) return;
  sim.phase = "play";
  unlockChime();
  say(sim, MISSIONS[0].brief);
  emitSim();
}

function restoreAge() {
  if (readAgeOk()) sim.ageOk = true;
}

export function setAgeOk(ok: boolean) {
  sim.ageOk = ok;
  writeAgeOk(ok);
  emitSim();
}

export { readAgeOk };
