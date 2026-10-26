/**
 * Roof ridge along the long wall of a footprint ring.
 * Points are [lng, lat]. A repeated closing point is ignored.
 * Fewer than four corners is a short ring and returns null.
 */

const METRES_PER_DEG_LNG = 111320;
const METRES_PER_DEG_LAT = 110540;

export function ridgeOf(ring: number[][]): { axis: "east" | "north"; lengthM: number } | null {
  const corners = withoutClosingPoint(ring);
  if (corners.length < 4) return null;

  let eastSpan = 0;
  let northSpan = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const east = Math.abs(b[0] - a[0]) * METRES_PER_DEG_LNG * Math.cos(midLat);
    const north = Math.abs(b[1] - a[1]) * METRES_PER_DEG_LAT;
    if (east > eastSpan) eastSpan = east;
    if (north > northSpan) northSpan = north;
  }

  const axis = eastSpan >= northSpan ? "east" : "north";
  const lengthM = Math.round(Math.max(eastSpan, northSpan) * 100) / 100;
  return { axis, lengthM };
}

function withoutClosingPoint(ring: number[][]): number[][] {
  if (ring.length < 2) return ring.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring.slice();
}
