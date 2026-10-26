import { CITIES, CITY_AGENTS } from "./cities.ts";

/** A newcomer joins a city that already has residents. They do not found it. */
export function humanWelcome(): string {
  return `This city is already lived in. ${CITY_AGENTS.length} residents keep public places in ${CITIES.length} cities. You join them. You do not found it.`;
}
