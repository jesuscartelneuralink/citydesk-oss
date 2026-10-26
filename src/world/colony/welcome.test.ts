import assert from "node:assert/strict";
import { test } from "node:test";
import { CITIES, CITY_AGENTS } from "./cities.ts";
import { humanWelcome } from "./welcome.ts";

test("a newcomer hears the city is already lived in", () => {
  const line = humanWelcome();
  assert.ok(line.includes(String(CITY_AGENTS.length)));
  assert.ok(line.includes(String(CITIES.length)));
  assert.ok(line.includes("You do not found it."));
  assert.equal(line.includes("wallet"), false);
});
