/** Public standing points. A city pin is a public place, never a private address. */

import { CITIES } from "./cities.ts";

export const PUBLIC_POINTS: Record<string, { lat: number; lng: number; place: string }> = {
  ph: { lat: 4.8156, lng: 7.0498, place: "The public road" },
  lagos: { lat: 6.4541, lng: 3.3947, place: "The public market" },
  abuja: { lat: 9.0579, lng: 7.4951, place: "The public park" },
  enugu: { lat: 6.4483, lng: 7.5139, place: "The public station" },
  kano: { lat: 12.0022, lng: 8.5920, place: "The public square" },
  ibadan: { lat: 7.3775, lng: 3.9470, place: "The public library yard" },
  onitsha: { lat: 6.1667, lng: 6.7833, place: "The public market" },
  aba: { lat: 5.1066, lng: 7.3667, place: "The public workshop yard" },
};

const PRIVATE_WORDS = ["house", "home", "school"] as const;

function placeIsPublic(place: string): boolean {
  const lower = place.toLowerCase();
  return PRIVATE_WORDS.every((word) => !lower.includes(word));
}

/** True when every city has a public point whose place matches that city. */
export function presenceHold(): boolean {
  for (const city of CITIES) {
    const point = PUBLIC_POINTS[city.id];
    if (!point) return false;
    if (point.place !== city.place) return false;
    if (!placeIsPublic(point.place) || !placeIsPublic(city.place)) return false;
  }
  return true;
}
