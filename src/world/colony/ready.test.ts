import assert from "node:assert/strict";
import { cityReadyForHumans } from "./ready.ts";

assert.equal(cityReadyForHumans(), true);

console.log("city ready for humans");
