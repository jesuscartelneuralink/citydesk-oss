/** A person may join only after the charter and the public cities hold. */
import { charterHolds } from "./charter.ts";
import { citiesHold, CITIES } from "./cities.ts";

const PRIVATE_PLACES = ["house", "home", "school"] as const;

function placeIsPrivate(place: string): boolean {
  const text = place.toLowerCase();
  return PRIVATE_PLACES.some((word) => text.includes(word));
}

/** True only when every shipped city and agent stays on a public place. */
export function cityReadyForHumans(): boolean {
  if (!charterHolds() || !citiesHold()) return false;
  if (CITIES.length < 8) return false;
  for (const city of CITIES) {
    if (placeIsPrivate(city.place)) return false;
    for (const agent of city.agents) {
      if (placeIsPrivate(agent.place)) return false;
    }
  }
  return true;
}
