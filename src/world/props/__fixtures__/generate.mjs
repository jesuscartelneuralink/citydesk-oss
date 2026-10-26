// @ts-nocheck
// Dev helper: regenerates the hand-made Overpass fixtures (run from this folder).
import fs from "node:fs";
let id = 1000;
const M = (lat) => ({ dLat: 1 / 111320, dLng: 1 / (111320 * Math.cos(lat * Math.PI / 180)) });
function make(lat0, lng0) {
  const { dLat, dLng } = M(lat0);
  const P = (x, y) => ({ lat: +(lat0 + y * dLat).toFixed(7), lon: +(lng0 + x * dLng).toFixed(7) });
  const els = [];
  const node = (x, y, tags) => { const n = { type: "node", id: ++id, ...P(x, y), tags }; els.push(n); return n; };
  const way = (pts, tags, nodeIds) => { const w = { type: "way", id: ++id, tags, nodes: nodeIds ?? pts.map(() => ++id), geometry: pts.map(([x, y]) => P(x, y)) }; els.push(w); return w; };
  return { els, node, way, P };
}
function write(name, els) { fs.writeFileSync(name, JSON.stringify({ osm3s: { timestamp_osm_base: "2026-10-09T12:00:00Z" }, elements: els }, null, 0)); }

// Port Harcourt: sparse — a few OSM items, one primary road unlit, a residential road
{
  const f = make(4.8156, 7.0498);
  const sig = 777001;
  f.way([[-160, 0], [0, 0], [160, 0]], { highway: "primary", name: "Aba Road", lanes: "4" }, [11, sig, 12]);
  f.way([[0, -150], [0, 0], [0, 150]], { highway: "residential", name: "Old GRA Street" }, [13, sig, 14]);
  f.way([[-100, 60], [100, 60]], { highway: "tertiary", lit: "yes", name: "Forces Avenue" });
  f.els.push({ type: "node", id: sig, ...f.P(0, 0), tags: { highway: "traffic_signals" } });
  f.node(20, 9, { amenity: "fast_food", name: "Mama Put" });
  f.node(-30, -8, { highway: "bus_stop", name: "Garrison", shelter: "no", bench: "yes" });
  f.node(40, 12, { natural: "tree" });
  f.node(45, 14, { natural: "tree", genus: "Elaeis", leaf_type: "palm" });
  f.node(-50, 10, { natural: "tree", species: "Mangifera indica" });
  f.node(60, 6, { power: "pole" });
  f.node(-80, -7, { power: "pole", material: "concrete" });
  f.node(10, -20, { man_made: "water_tap" });
  f.node(70, 62, { highway: "street_lamp" });
  f.way([[-60, 100], [-20, 100], [-20, 140], [-60, 140], [-60, 100]], { leisure: "park", name: "Isaac Boro Park" });
  write("ph-cell.json", f.els);
}
// London Bloomsbury: dense — lamps with light:method, signs, bins, benches, postbox, bollards, signals
{
  const f = make(51.5226, -0.1265);
  const sig = 888001;
  f.way([[-160, 0], [0, 0], [160, 0]], { highway: "secondary", name: "Gower Street", lit: "yes", lanes: "2" }, [21, sig, 22]);
  f.way([[0, -150], [0, 0], [0, 150]], { highway: "tertiary", name: "Torrington Place", lit: "yes", oneway: "yes" }, [23, sig, 24]);
  f.way([[-150, 80], [150, 80]], { highway: "footway", lit: "yes" });
  f.way([[-140, -60], [-20, -60]], { natural: "tree_row", genus: "Platanus" });
  f.way([[30, 30], [120, 30], [120, 120], [30, 120], [30, 30]], { leisure: "park", name: "Gordon Square" });
  f.way([[-120, 90], [-80, 90], [-80, 130], [-120, 130], [-120, 90]], { amenity: "parking", parking: "surface" });
  f.els.push({ type: "node", id: sig, ...f.P(0, 0), tags: { highway: "traffic_signals" } });
  for (let i = 0; i < 8; i++) f.node(-140 + i * 35, 6.5, { highway: "street_lamp", "light:method": i % 2 ? "LED" : "high_pressure_sodium", lamp_mount: i === 3 ? "wall" : "bent_mast" });
  for (let i = 0; i < 5; i++) f.node(-6.5, -140 + i * 30, { highway: "street_lamp", "light:method": "LED", lamp_mount: "straight_mast" });
  f.node(5, -20, { highway: "stop", direction: "N" });
  f.node(-5, 20, { highway: "give_way" });
  f.node(30, -6, { traffic_sign: "GB:670", maxspeed: "20 mph" });
  f.node(50, -6, { traffic_sign: "GB:2401" });
  for (let i = 0; i < 6; i++) f.node(40 + i * 12, 85, { amenity: "bench", backrest: i % 3 ? "yes" : "no", material: "wood" });
  for (let i = 0; i < 4; i++) f.node(45 + i * 20, 78, { amenity: "waste_basket", support: i % 2 ? "pole" : "ground" });
  f.node(70, -7, { amenity: "post_box", ref: "WC1E 123" });
  f.node(-70, -9, { highway: "bus_stop", shelter: "yes", bin: "yes", lit: "yes", name: "Gower Street" });
  f.node(90, -7, { amenity: "recycling", recycling_type: "container" });
  for (let i = 0; i < 6; i++) f.node(100 + i * 1.6, 7, { barrier: "bollard" });
  f.node(-30, 8, { man_made: "street_cabinet" });
  f.node(-40, -8, { emergency: "fire_hydrant", "fire_hydrant:type": "underground" });
  for (let i = 0; i < 10; i++) f.node(40 + (i % 5) * 15, 40 + Math.floor(i / 5) * 30, { natural: "tree", genus: i % 2 ? "Platanus" : "Tilia", circumference: String(1 + i * 0.2) });
  f.node(25, 50, { natural: "tree", height: "40'" });
  write("london-cell.json", f.els);
}
// Honolulu Kapiolani: palms by taxon, monkeypods
{
  const f = make(21.2667, -157.8215);
  f.way([[-160, 0], [160, 0]], { highway: "secondary", name: "Kalakaua Avenue", lit: "yes", lanes: "2" });
  f.way([[-100, 40], [-100, 140], [100, 140], [100, 40], [-100, 40]], { leisure: "park", name: "Kapiolani Park" });
  for (let i = 0; i < 8; i++) f.node(-120 + i * 30, 8, { natural: "tree", taxon: "Arecaceae" });
  for (let i = 0; i < 4; i++) f.node(-60 + i * 40, 70, { natural: "tree", species: "Samanea saman" });
  f.node(0, 90, { natural: "tree", genus: "Cocos", height: "22" });
  f.node(10, -7, { highway: "street_lamp", "light:method": "LED" });
  f.node(40, -7, { highway: "street_lamp" });
  f.node(20, 50, { amenity: "drinking_water" });
  f.node(30, 50, { amenity: "bench" });
  f.node(-20, -8, { emergency: "fire_hydrant", "fire_hydrant:type": "pillar", colour: "yellow" });
  write("honolulu-cell.json", f.els);
}
