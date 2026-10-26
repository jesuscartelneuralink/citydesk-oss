import assert from "node:assert/strict";
import { test } from "node:test";
import { CITY_AGENTS } from "./cities.ts";
import { dayPost } from "./day.ts";

const NOON = "Keeps the public place through noon.";
const NIGHT = "Stays at the public place. No night errand.";
const FORBIDDEN = ["house", "school", "wallet"];

function assertRoster(rows: ReturnType<typeof dayPost>) {
  assert.equal(rows.length, CITY_AGENTS.length);
  assert.equal(rows.length > 0, true);
  for (const row of rows) {
    const agent = CITY_AGENTS.find((item) => item.id === row.id);
    assert.ok(agent);
    assert.equal(row.name, agent.name);
    assert.equal(row.place, agent.place);
    const blob = `${row.doing}\n${row.place}`.toLowerCase();
    for (const word of FORBIDDEN) {
      assert.equal(blob.includes(word), false);
    }
  }
}

function dutiesMatch(minute: number) {
  const rows = dayPost(minute);
  assertRoster(rows);
  for (const row of rows) {
    const agent = CITY_AGENTS.find((item) => item.id === row.id);
    assert.equal(row.doing, agent?.duty);
  }
}

function allDoing(minute: number, doing: string) {
  const rows = dayPost(minute);
  assertRoster(rows);
  for (const row of rows) assert.equal(row.doing, doing);
}

test("minute 200 stays at the public place", () => {
  allDoing(200, NIGHT);
});

test("minute 700 keeps the public place through noon", () => {
  allDoing(700, NOON);
});

test("minute 480 is the morning duty", () => {
  dutiesMatch(480);
});

test("minute 960 is the afternoon duty", () => {
  dutiesMatch(960);
});

test("band edges and out-of-range minutes clamp", () => {
  dutiesMatch(360);
  dutiesMatch(659);
  allDoing(660, NOON);
  allDoing(839, NOON);
  dutiesMatch(840);
  dutiesMatch(1079);
  allDoing(0, NIGHT);
  allDoing(1080, NIGHT);
  allDoing(1439, NIGHT);
  allDoing(-1, NIGHT);
  allDoing(2000, NIGHT);
  assert.deepEqual(
    dayPost(-40).map((row) => row.doing),
    dayPost(0).map((row) => row.doing),
  );
  assert.deepEqual(
    dayPost(9000).map((row) => row.place),
    CITY_AGENTS.map((agent) => agent.place),
  );
});
