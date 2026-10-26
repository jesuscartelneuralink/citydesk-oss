import { REAL_BUILDINGS, REAL_ROOFS } from "./layers.ts";
import { renderSettings } from "./settings.ts";
import { getRealism, refreshRealism, subscribeRealism } from "./state.ts";
import { hex, mapLight, sunAt, sunVector } from "./sun.ts";
import { buildingShadows } from "../shadows/buildings.ts";
import { fromTileFeatures, type BuildingCollection, type BuildingFeature, type TileBuilding, type TileLanduse } from "./buildingsData.ts";
import { inspectAllowed } from "../inspect/flag.ts"; // NDU-UPG inspect (#04)
import { MATERIALS, tintFor, type MaterialKey } from "../render/materialCatalog.ts"; // NDU-UPG inspect (#04)
import { cellOf, osmBuildings, type CellAnswer } from "./osmBuildings.ts";
import { addGroundShadows } from "../shadows/mount.ts";
import { publishBuildings, publishEntrances, publishTileFootprints } from "@/world/collide/bus"; // NDU-UPG collide

/**
 * Realism layer for the 3D city map (NDU-UPG Do-first #6 #7 + P1s of categories 1-2).
 * Mounted once from CityBuildings after the style loads; owns its own sources/layers and only
 * *adjusts* the style's `building-3d` (tint, gradient, fade, and hiding the tile twins of the
 * buildings it redraws with real heights). Returns a dispose function.
 *
 *   #5 #6  real sun → map.setLight (anchor map) — the three.js scans read the same sun (scanLook.ts)
 *   #8     extrusion colour tinted by sun altitude, refreshed once a minute (not per frame)
 *   #26    hover highlight via feature-state (pointer devices)
 *   #28    sky/horizon/fog colours per time of day (setSky)
 *   #30    WebGL context-loss card
 *   #40    no lighting updates while the user drags/rotates
 *   #41 #58 tagged building/roof colours + hash variation; roof-cap extrusions (tier A/B)
 *   #51 #56 #62 tag-accurate heights with type/landuse priors from OSM (osmBuildings.ts), and a
 *          network-free fallback that fixes 0 m / untagged tile heights from the basemap itself
 *   #53    OSM attribution on the derived building source
 *   #65 #66 zoom fade-in + vertical gradient on extrusions
 *   #16    lit-window pattern on extrusions after dark (tier A/B), plain roof caps, dimmed ground
 */

type Feat = { id?: number | string };
type RMap = {
  getLayer: (id: string) => unknown;
  addLayer: (layer: Record<string, unknown>, before?: string) => void;
  removeLayer: (id: string) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  addSource: (id: string, source: Record<string, unknown>) => void;
  removeSource: (id: string) => void;
  setPaintProperty: (layer: string, name: string, value: unknown) => void;
  getPaintProperty: (layer: string, name: string) => unknown;
  setFilter: (layer: string, filter: unknown) => void;
  getFilter: (layer: string) => unknown;
  setLight: (light: Record<string, unknown>) => void;
  setSky?: (sky: Record<string, unknown>) => void;
  setPixelRatio?: (ratio: number) => void;
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  isMoving: () => boolean;
  on: (event: string, a: unknown, b?: unknown) => void;
  off: (event: string, a: unknown, b?: unknown) => void;
  getCanvas: () => HTMLCanvasElement;
  getContainer: () => HTMLElement;
  hasImage: (id: string) => boolean;
  addImage: (id: string, image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, options?: Record<string, unknown>) => void;
  removeImage: (id: string) => void;
  setFeatureState: (target: { source: string; id: number | string }, state: Record<string, unknown>) => void;
  querySourceFeatures: (source: string, options: { sourceLayer: string }) => { id?: number | string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[];
};

const TILE_LAYER = "building-3d";
const SRC = "ndu-real-buildings-src";
const EMPTY: BuildingCollection = { type: "FeatureCollection", features: [] };
const MAX_CELLS = 4;
const WINDOW_IMAGES = ["ndu-win-0", "ndu-win-1", "ndu-win-2"];
const NIGHT_DIM = "ndu-night-dim";
const NIGHT_SRC = "ndu-night-dim-src";
const WORLD = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } };

function shade(hexColour: string, f: number) {
  const n = parseInt(hexColour.slice(1), 16);
  const ch = (s: number) => Math.round(Math.min(255, Math.max(0, ((n >> s) & 255) * f)));
  return hex([ch(16), ch(8), ch(0)]);
}

/** 16×32 lit-window tiles (3 variants) drawn in code — no asset download (#16). */
function windowImage(seed: number) {
  const w = 16;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const win = x >= 4 && x < 12 && ((y >= 4 && y < 12) || (y >= 20 && y < 28));
      const lit = win && ((seed + (y < 16 ? 0 : 1)) % 3 !== 0);
      const ring = !win && x >= 3 && x < 13 && ((y >= 3 && y < 13) || (y >= 19 && y < 29));
      const glow = ring && ((seed + (y < 16 ? 0 : 1)) % 3 !== 0);
      const [r, g, b] = lit ? [255, 214, 140] : glow ? [255, 176, 80] : win ? [40, 46, 66] : [58, 62, 82];
      data.set([r, g, b, 255], i);
    }
  return { width: w, height: h, data };
}

// NDU-UPG inspect (#04): material tint table per palette base (cached) and the inspect highlight.
const tintCache = new Map<string, (string)[]>();
function materialTints(base: string): string[] {
  const hit = tintCache.get(base);
  if (hit) return hit;
  const out: string[] = [];
  for (const k of Object.keys(MATERIALS) as MaterialKey[]) if (k !== "unknown") out.push(k, tintFor(base, k));
  tintCache.set(base, out);
  return out;
}

let inspected: number | null = null;
type StateMap = { setFeatureState?: (f: { source: string; id: number }, s: Record<string, boolean>) => void; getSource?: (id: string) => unknown };
/** Glow one realism building (by OSM id), clearing the previous one; null clears. */
export function setInspectHighlight(map: unknown, id: number | null): void {
  const m = map as StateMap;
  try {
    if (!m.getSource?.(SRC)) return;
    if (inspected !== null && inspected !== id) m.setFeatureState?.({ source: SRC, id: inspected }, { inspect: false });
    if (id !== null) m.setFeatureState?.({ source: SRC, id }, { inspect: true });
    inspected = id;
  } catch {
    inspected = null;
  }
}

export function mountRealism(input: unknown): () => void {
  const map = input as RMap;
  const cfg = renderSettings();
  const offs: (() => void)[] = [];
  const on = (event: string, a: unknown, b?: unknown) => {
    map.on(event, a, b);
    offs.push(() => (b === undefined ? map.off(event, a) : map.off(event, a, b)));
  };
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      if (import.meta.env.DEV) console.warn("[realism]", (err as Error).message);
    }
  };

  // #19 pixel-ratio clamp is owned by the perf track (src/world/perf/mapPerf.ts on upg/perf-tiering).
  const c0 = map.getCenter();
  refreshRealism(c0.lat, c0.lng);

  // ── layers ───────────────────────────────────────────────────────────────
  const hasTile = Boolean(map.getLayer(TILE_LAYER));
  const tileFilter = hasTile ? map.getFilter(TILE_LAYER) : undefined;
  const tileColour = hasTile ? map.getPaintProperty(TILE_LAYER, "fill-extrusion-color") : undefined;
  const tileOpacity = hasTile ? map.getPaintProperty(TILE_LAYER, "fill-extrusion-opacity") : undefined;
  const fade = (to: number) => ["interpolate", ["linear"], ["zoom"], 14, 0, 15, to];
  safe(() => {
    map.addSource(SRC, { type: "geojson", data: EMPTY, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL)' });
    // No building shadow FeatureCollection is in scope; the caller can setData later.
    addGroundShadows(map, { type: "FeatureCollection", features: [] }, REAL_BUILDINGS);
    map.addLayer({
      id: REAL_BUILDINGS,
      type: "fill-extrusion",
      source: SRC,
      minzoom: 14,
      paint: {
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": ["get", "b"],
        "fill-extrusion-opacity": fade(0.95),
        "fill-extrusion-vertical-gradient": true,
      },
    });
    if (cfg.roofs)
      map.addLayer({
        id: REAL_ROOFS,
        type: "fill-extrusion",
        source: SRC,
        minzoom: 15,
        // Tier A: every roof gets a cap; tier B: only roofs with a tagged colour (keeps draw cost down).
        filter: cfg.tier === "A" ? [">", ["get", "h"], 2.5] : ["all", [">", ["get", "h"], 2.5], ["!=", ["get", "rc"], ""]],
        paint: {
          "fill-extrusion-base": ["get", "h"],
          "fill-extrusion-height": ["+", ["get", "h"], 0.35],
          "fill-extrusion-opacity": fade(0.95),
        },
      });
  });
  // Night: dim the ground + roads (one fill under the extrusions; labels stay readable above it).
  safe(() => {
    map.addSource(NIGHT_SRC, { type: "geojson", data: WORLD });
    map.addLayer({ id: NIGHT_DIM, type: "fill", source: NIGHT_SRC, paint: { "fill-color": "#0b1030", "fill-opacity": 0 } }, hasTile ? TILE_LAYER : REAL_BUILDINGS);
  });
  if (hasTile)
    safe(() => {
      map.setPaintProperty(TILE_LAYER, "fill-extrusion-vertical-gradient", true);
      map.setPaintProperty(TILE_LAYER, "fill-extrusion-opacity", fade(0.85));
    });

  // ── sun → light, sky, tints, windows (#5 #6 #8 #16 #28) ────────────────────────
  let glassMode: "night" | "day" | "off" = "off";
  const windowsOn = false;
  const inspectOn = inspectAllowed(); // NDU-UPG inspect (#04)
  const applySun = () => {
    const { sun, pal } = getRealism();
    safe(() => map.setLight(mapLight(sun, pal)));
    safe(() =>
      map.setSky?.({
        "sky-color": pal.sky,
        "horizon-color": pal.horizon,
        "fog-color": pal.fog,
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.75,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0],
      }),
    );
    const base = pal.building;
    // Neighbours must not share one grey. Kind picks a family; the OSM id picks a shade inside it.
    const families = ["#e6d3bc", "#c4a574", "#a24b32", "#8d4b3a", "#9aa7a1", "#7f878c", "#d5d0c4", "#efe8dc"];
    const varied: unknown[] = ["interpolate", ["linear"], ["%", ["to-number", ["get", "osm"], 0], 8]];
    families.forEach((hex, i) => varied.push(i, hex));
    const kinded: unknown[] = [
      "match",
      ["coalesce", ["get", "kind"], "yes"],
      "church", "#efe8dc",
      "cathedral", "#efe8dc",
      "mosque", "#e4efe6",
      "chapel", "#efe8dc",
      "commercial", "#c9854a",
      "retail", "#d7a15a",
      "industrial", "#7f878c",
      "warehouse", "#8a8478",
      "school", "#d5d0c4",
      "university", "#d5d0c4",
      "apartments", "#b7a48c",
      "house", "#e6d3bc",
      "residential", "#ddcbb6",
      "hotel", "#c9b79a",
      "hospital", "#e8e4dc",
      "garage", "#9a9286",
      "shed", "#a89880",
      varied,
    ];
    const tileVaried: unknown[] = ["interpolate", ["linear"], ["%", ["to-number", ["id"]], 8]];
    families.forEach((hex, i) => tileVaried.push(i, hex));
    const roofBase = shade(base, 0.72);
    safe(() => {
      if (!map.getLayer(REAL_BUILDINGS)) return;
      // NDU-UPG inspect (#04): with the flag on, the inspected building glows and tagged materials tint
      // the palette (±10% luminance, so night still dominates). Flag off: the exact old expression.
      const inspectCase = inspectOn ? [["boolean", ["feature-state", "inspect"], false], "#7cc4d8"] : [];
      const materialCase = inspectOn && cfg.tier !== "C" ? [["!=", ["coalesce", ["get", "m"], ""], ""], ["match", ["coalesce", ["get", "m"], ""], ...materialTints(base), varied]] : [];
      map.setPaintProperty(REAL_BUILDINGS, "fill-extrusion-color", [
        "case",
        ...inspectCase,
        ["boolean", ["feature-state", "hover"], false],
        "#f0c14a",
        ["!=", ["get", "c"], ""],
        ["to-color", ["get", "c"], base],
        ...materialCase,
        kinded,
      ]);
      if (map.getLayer(REAL_ROOFS)) map.setPaintProperty(REAL_ROOFS, "fill-extrusion-color", ["case", ["!=", ["get", "rc"], ""], ["to-color", ["get", "rc"], roofBase], roofBase]);
    });
    if (hasTile) safe(() => map.setPaintProperty(TILE_LAYER, "fill-extrusion-color", tileVaried));
    safe(() => map.getLayer(NIGHT_DIM) && map.setPaintProperty(NIGHT_DIM, "fill-opacity", Math.round(pal.night * 0.6 * 100) / 100));
    const wantWindows = cfg.nightWindows && pal.night > 0.6;
    const wantDay = cfg.tier !== "C" && pal.night < 0.25 && !wantWindows;
    const nextGlass = wantWindows ? "night" : wantDay ? "day" : "off";
    if (nextGlass !== glassMode)
      safe(() => {
        glassMode = nextGlass;
        WINDOW_IMAGES.forEach((id, n) => {
          if (wantWindows && !map.hasImage(id)) map.addImage(id, windowImage(n), { pixelRatio: 1 });
        });
        if (wantDay && !map.hasImage("ndu-win-day")) map.addImage("ndu-win-day", dayGlass(), { pixelRatio: 1 });
        const pattern = wantWindows
          ? ["concat", "ndu-win-", ["to-string", ["%", ["to-number", ["get", "osm"], 0], 3]]]
          : wantDay
            ? "ndu-win-day"
            : undefined;
        map.setPaintProperty(REAL_BUILDINGS, "fill-extrusion-pattern", pattern);
        // roof caps so a window pattern stays on the walls
        if (map.getLayer(REAL_ROOFS)) map.setFilter(REAL_ROOFS, wantWindows || wantDay || cfg.tier === "A" ? [">", ["get", "h"], 2.5] : ["all", [">", ["get", "h"], 2.5], ["!=", ["get", "rc"], ""]]);
        if (hasTile) map.setPaintProperty(TILE_LAYER, "fill-extrusion-pattern", wantWindows ? ["concat", "ndu-win-", ["to-string", ["%", ["to-number", ["id"], 0], 3]]] : wantDay ? "ndu-win-day" : undefined);
      });
  };

  // #40: never restyle mid-gesture; apply once the camera settles.
  let dirty = false;
  const busy = () => map.isMoving() || document.documentElement.dataset.nduPanning === "1";
  const requestApply = () => {
    if (busy()) {
      dirty = true;
      return;
    }
    dirty = false;
    applySun();
  };
  applySun();
  offs.push(subscribeRealism(requestApply));
  const minute = window.setInterval(() => refreshRealism(), 60_000);
  offs.push(() => window.clearInterval(minute));

  // ── real buildings per cell (#51 #56) ─────────────────────────────────────────
  const cells = new Map<string, { features: BuildingFeature[]; covered: number[] }>();
  let loading: string | null = null;
  let retryAt = 0;
  let dead = false;
  // Network-free fallback (#56): re-derive wrong/untagged heights from the basemap tiles themselves.
  let fromTiles: { features: BuildingFeature[]; covered: number[] } = { features: [], covered: [] };
  const tileSource = hasTile ? ((map.getLayer(TILE_LAYER) as { source?: string }).source ?? "openmaptiles") : null;
  const polys = (g: { type: string; coordinates: unknown }) => (g.type === "Polygon" ? [g.coordinates as number[][][]] : g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : []);
  const RADIUS_DEG = 0.009; // ~1 km: horizon tiles at high pitch are left to the basemap
  let scanQueued = false;
  const idle = (fn: () => void) => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(fn, { timeout: 1500 });
    else window.setTimeout(fn, 50);
  };
  const scanTiles = () => {
    if (!tileSource || scanQueued || map.getZoom() < 14.5) return;
    scanQueued = true;
    idle(() => {
      scanQueued = false;
      if (!dead) scanNow();
    });
  };
  let scanCount = 0;
  const scanNow = () => {
    if (!tileSource) return;
    scanCount += 1;
    safe(() => {
      const t0 = performance.now();
      const { lng: cx, lat: cy } = map.getCenter();
      const kx = Math.cos((cy * Math.PI) / 180);
      const near = (rings: number[][][]) => {
        const p = rings[0]?.[0];
        return Boolean(p) && Math.abs(p[1] - cy) < RADIUS_DEG && Math.abs(p[0] - cx) * kx < RADIUS_DEG;
      };
      const blds: TileBuilding[] = [];
      for (const f of map.querySourceFeatures(tileSource, { sourceLayer: "building" }))
        if (typeof f.id === "number") for (const rings of polys(f.geometry)) if (near(rings)) blds.push({ id: f.id, props: f.properties, rings });
      const land: TileLanduse[] = [];
      for (const f of map.querySourceFeatures(tileSource, { sourceLayer: "landuse" })) for (const rings of polys(f.geometry)) land.push({ cls: String(f.properties.class ?? ""), rings });
      const skip = new Set<number>();
      for (const cell of cells.values()) cell.covered.forEach((id) => skip.add(id));
      fromTiles = fromTileFeatures(blds, land, skip);
      publishTileFootprints(blds); // NDU-UPG collide
      if (import.meta.env.DEV) console.info(`[realism] tiles: ${blds.length} footprints, ${fromTiles.features.length} re-heighted in ${Math.round(performance.now() - t0)} ms`);
    });
    redraw();
  };
  let lastIds = 0;
  const redraw = () => {
    const feats = new Map<number | string, BuildingFeature>();
    const covered = new Set<number>();
    for (const cell of cells.values()) {
      cell.features.forEach((f) => feats.set(f.id, f));
      cell.covered.forEach((id) => covered.add(id));
    }
    const tileFeats = fromTiles.features.filter((f) => !covered.has(f.id));
    fromTiles.covered.forEach((id) => covered.add(id));
    const drawn = [...feats.values(), ...tileFeats];
    safe(() => map.getSource(SRC)?.setData({ type: "FeatureCollection", features: drawn }));
    const { lat, lng } = map.getCenter();
    const blobs = buildingShadows(drawn, sunVector(sunAt(new Date(), lat, lng)));
    safe(() => map.getSource("ndu-ground-shadows-src")?.setData(blobs));
    publishBuildings(drawn); // NDU-UPG collide
    if (!hasTile) return;
    const ids = [...covered].filter(Number.isSafeInteger);
    lastIds = ids.length;
    const hide = ids.length ? ["match", ["floor", ["/", ["to-number", ["id"], 0], 10]], ids, false, true] : null;
    safe(() => map.setFilter(TILE_LAYER, hide ? (tileFilter ? ["all", tileFilter, hide] : hide) : (tileFilter ?? null)));
  };
  const loadCell = () => {
    if (dead || loading || Date.now() < retryAt || map.getZoom() < 14.5) return;
    const { lat, lng } = map.getCenter();
    const key = cellOf(lat, lng).key;
    if (cells.has(key)) {
      const hit = cells.get(key);
      cells.delete(key); // LRU bump
      if (hit) cells.set(key, hit);
      return;
    }
    loading = key;
    void osmBuildings({ data: { lat, lng } })
      .then((answer: CellAnswer) => {
        if (dead) return;
        if (!answer.ok) {
          retryAt = Date.now() + answer.retryMs;
          return;
        }
        cells.set(answer.cell, { features: answer.data.features, covered: answer.covered });
        publishEntrances(answer.cell, answer.entrances ?? []); // NDU-UPG collide
        while (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value as string);
        scanTiles();
        if (import.meta.env.DEV) console.info(`[realism] cell ${answer.cell}: ${answer.data.features.length} buildings`);
      })
      .catch(() => {
        retryAt = Date.now() + 30_000;
      })
      .finally(() => {
        loading = null;
      });
  };
  let settle = 0;
  const onMoveEnd = () => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      if (dirty) requestApply();
      refreshRealism(map.getCenter().lat, map.getCenter().lng);
      loadCell();
      scanTiles();
    }, 700);
  };
  on("moveend", onMoveEnd);
  offs.push(() => window.clearTimeout(settle));
  loadCell();
  // First pass once the basemap tiles under the camera have arrived (tiles stream in after "load").
  let firstScans = 0;
  const onIdle = () => {
    firstScans += 1;
    scanTiles();
    if (firstScans >= 2) map.off("idle", onIdle);
  };
  on("idle", onIdle);

  // ── hover (#26) ──────────────────────────────────────────────────────────────
  if (cfg.hover) {
    let hovered: number | string | null = null;
    const clear = () => {
      if (hovered != null) safe(() => map.setFeatureState({ source: SRC, id: hovered as number }, { hover: false }));
      hovered = null;
    };
    on("mousemove", REAL_BUILDINGS, (e: { features?: Feat[] }) => {
      const id = e.features?.[0]?.id;
      if (id == null || id === hovered) return;
      clear();
      hovered = id;
      safe(() => map.setFeatureState({ source: SRC, id }, { hover: true }));
    });
    on("mouseleave", REAL_BUILDINGS, clear);
  }

  // ── WebGL context loss (#30) ───────────────────────────────────────────────────
  const canvas = map.getCanvas();
  let card: HTMLDivElement | null = null;
  let losses = 0;
  const onLost = () => {
    losses += 1;
    card?.remove();
    card = document.createElement("div");
    card.setAttribute("role", "status");
    card.style.cssText =
      "position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);z-index:600;background:#1a1511;color:#f6efe2;padding:14px 18px;border-radius:16px;font:600 14px/1.3 sans-serif;text-align:center;box-shadow:0 5px 0 #000,0 12px 28px rgba(0,0,0,.45);border-bottom:4px solid #e8843a;max-width:260px";
    card.textContent = losses >= 2 ? "The 3D city keeps dropping on this phone. Reload, or close other apps to free memory." : "Restoring the city…";
    if (losses >= 2) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Reload";
      btn.style.cssText = "display:block;margin:10px auto 0;min-height:44px;padding:0 18px;border-radius:999px;border:0;background:#e8843a;color:#1a1511;font:700 14px sans-serif;box-shadow:0 4px 0 #8a4a1c";
      btn.onclick = () => window.location.reload();
      card.append(btn);
    }
    map.getContainer().append(card);
  };
  const onRestored = () => {
    if (losses < 2) {
      card?.remove();
      card = null;
    }
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  offs.push(() => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    card?.remove();
  });

  if (import.meta.env.DEV) (window as Window & { __nduRealism?: unknown }).__nduRealism = { map, state: getRealism, cells, debug: () => ({ tileFeats: fromTiles.features.length, tileCovered: fromTiles.covered.length, filterIds: lastIds, scans: scanCount }) };

  return () => {
    dead = true;
    offs.splice(0).forEach((off) => safe(off));
    safe(() => {
      for (const id of [REAL_ROOFS, REAL_BUILDINGS, NIGHT_DIM]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [SRC, NIGHT_SRC]) if (map.getSource(id)) map.removeSource(id);
      WINDOW_IMAGES.forEach((id) => map.hasImage(id) && map.removeImage(id));
      if (hasTile) {
        map.setFilter(TILE_LAYER, tileFilter ?? null);
        map.setPaintProperty(TILE_LAYER, "fill-extrusion-color", tileColour);
        map.setPaintProperty(TILE_LAYER, "fill-extrusion-opacity", tileOpacity);
        map.setPaintProperty(TILE_LAYER, "fill-extrusion-pattern", undefined);
      }
    });
  };
}

function dayGlass() {
  const w = 16;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const glass = x >= 4 && x < 12 && ((y >= 4 && y < 12) || (y >= 20 && y < 28));
      const c = glass ? [86, 104, 118] : [186, 176, 162];
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}
