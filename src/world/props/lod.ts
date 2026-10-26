import type { PropKind } from "./types.ts";

/**
 * NDU-UPG props: LOD + budget planner (PLAN §5.2, §6). Pure, alias-free.
 * near = full mesh · mid = low mesh · far = trees (low) and lamps (night glow only) · beyond = culled.
 */

export type Tier = "A" | "B" | "C";
export type Band = "near" | "mid" | "far";
export type CapGroup = "trees" | "lamps" | "kit" | "cars";
export type TierLod = { near: number; mid: number; far: number; maxTris: number; caps: Record<CapGroup, number> };

export const TIER_LOD: Record<Tier, TierLod> = {
  A: { near: 90, mid: 220, far: 600, maxTris: 60_000, caps: { trees: 1200, lamps: 600, kit: 400, cars: 150 } },
  B: { near: 50, mid: 140, far: 300, maxTris: 20_000, caps: { trees: 300, lamps: 200, kit: 120, cars: 60 } },
  C: { near: 0, mid: 0, far: 0, maxTris: 0, caps: { trees: 0, lamps: 0, kit: 0, cars: 0 } },
};

/** Drop priority: higher survives the budget clamp (lamps carry the night, so they go last). */
export const DROP_PRIORITY: Record<PropKind, number> = {
  lamp: 9, traffic_signals: 7, bus_stop: 6, tree: 5, bench: 4, utility_pole: 4, stop_sign: 3, give_way_sign: 3, traffic_sign: 3,
  parked_car: 2, food_stall: 2, waste_basket: 1, recycling: 1, fire_hydrant: 1, post_box: 1, bollard: 1, street_cabinet: 1, standpipe: 1,
};

export const capGroup = (k: PropKind): CapGroup => (k === "tree" ? "trees" : k === "lamp" ? "lamps" : k === "parked_car" ? "cars" : "kit");

export type LodItem = { x: number; y: number; kind: PropKind; archetype: string };
export type LodCam = { x: number; y: number; bearing: number; hfov: number; /** metres the camera sits behind the focus */ back?: number };
export type LodQuality = { step: number; radiusScale?: number };
export type BandLists = { near: Int32Array; mid: Int32Array; far: Int32Array };
export type LodPlan = { byArchetype: Map<string, BandLists>; tris: number; counts: Record<CapGroup, number>; dropped: number };

export function radiusScale(q: LodQuality): number {
  if (q.radiusScale != null) return q.radiusScale;
  return q.step >= 4 ? 0.5 : q.step >= 3 ? 0.7 : 1;
}

const RAD = Math.PI / 180;

/**
 * @param tris (archetype, band) → triangles drawn for that item in that band (far lamps = 2, glow quad)
 */
export function lodPlan(items: LodItem[], cam: LodCam, tier: Tier, q: LodQuality, tris: (archetype: string, band: Band) => number, fogFar = 1): LodPlan {
  const L = TIER_LOD[tier];
  const s = radiusScale(q);
  const rn = L.near * s;
  const rm = L.mid * s;
  const rf = L.far * s * fogFar;
  const half = (cam.hfov / 2 + 15) * RAD;
  const fx = Math.sin(cam.bearing * RAD);
  const fy = Math.cos(cam.bearing * RAD);
  const back = cam.back ?? rn;
  const ax = cam.x - fx * back;
  const ay = cam.y - fy * back;
  const cand: { i: number; d: number; band: Band; pr: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const d = Math.hypot(it.x - cam.x, it.y - cam.y);
    if (d >= rf) continue;
    const band: Band = d < rn ? "near" : d < rm ? "mid" : "far";
    if (band === "far" && it.kind !== "tree" && it.kind !== "lamp") continue;
    if (d > 30) {
      // conservative view cone from the camera ground point
      const vx = it.x - ax;
      const vy = it.y - ay;
      const vl = Math.hypot(vx, vy) || 1;
      if ((vx * fx + vy * fy) / vl < Math.cos(Math.min(Math.PI, half))) continue;
    }
    cand.push({ i, d, band, pr: DROP_PRIORITY[it.kind] });
  }
  cand.sort((a, b) => b.pr - a.pr || a.d - b.d || a.i - b.i);
  const counts: Record<CapGroup, number> = { trees: 0, lamps: 0, kit: 0, cars: 0 };
  const lists = new Map<string, { near: number[]; mid: number[]; far: number[] }>();
  let total = 0;
  let dropped = 0;
  for (const c of cand) {
    const it = items[c.i];
    const g = capGroup(it.kind);
    if (counts[g] >= L.caps[g]) {
      dropped++;
      continue;
    }
    let band = c.band;
    let t = tris(it.archetype, band);
    if (total + t > L.maxTris && band === "near") {
      // degrade to the low mesh before dropping
      band = "mid";
      t = tris(it.archetype, band);
    }
    if (total + t > L.maxTris) {
      dropped++;
      continue;
    }
    total += t;
    counts[g]++;
    let e = lists.get(it.archetype);
    if (!e) lists.set(it.archetype, (e = { near: [], mid: [], far: [] }));
    e[band].push(c.i);
  }
  const byArchetype = new Map<string, BandLists>();
  for (const [k, v] of lists) byArchetype.set(k, { near: Int32Array.from(v.near), mid: Int32Array.from(v.mid), far: Int32Array.from(v.far) });
  return { byArchetype, tris: total, counts, dropped };
}

/** Replan only after the camera moved > 8 m or turned > 3° (a still camera does no CPU work). */
export function needsReplan(prev: LodCam | null, cam: LodCam): boolean {
  if (!prev) return true;
  const turn = Math.abs(((cam.bearing - prev.bearing + 540) % 360) - 180);
  return Math.hypot(cam.x - prev.x, cam.y - prev.y) > 8 || turn > 3;
}
