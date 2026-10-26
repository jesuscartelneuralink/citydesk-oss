import { CITY_AGENTS } from "./cities.ts";

const NOON = "Keeps the public place through noon.";
const NIGHT = "Stays at the public place. No night errand.";

/** Minute of the local day, inclusive. */
function clampMinute(minute: number): number {
  if (!Number.isFinite(minute)) return 0;
  const whole = Math.trunc(minute);
  if (whole < 0) return 0;
  if (whole > 1439) return 1439;
  return whole;
}

function doingAt(minute: number, duty: string): string {
  // 6:00–11:00 duty, 11:00–14:00 noon watch, 14:00–18:00 duty, else stay put.
  if (minute >= 360 && minute <= 659) return duty;
  if (minute >= 660 && minute <= 839) return NOON;
  if (minute >= 840 && minute <= 1079) return duty;
  return NIGHT;
}

export function dayPost(
  minute: number,
): { id: string; name: string; place: string; doing: string }[] {
  const at = clampMinute(minute);
  return CITY_AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    place: agent.place,
    doing: doingAt(at, agent.duty),
  }));
}
