/** Three interiors a door can open into. */
export type RoomKind = "shop" | "home" | "hall";

const SHOPS = new Set(["retail", "commercial", "shop", "supermarket", "kiosk"]);
const HOMES = new Set(["house", "residential", "apartments"]);

/**
 * Map a building-use label to a room kind.
 * Comparison ignores case. Anything else, including the empty string, is a hall.
 */
export function roomKind(kind: string): RoomKind {
  const key = kind.toLowerCase();
  if (SHOPS.has(key)) return "shop";
  if (HOMES.has(key)) return "home";
  return "hall";
}
