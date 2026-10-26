// NDU-41/#10: phone-size e2e smoke. Loads /map at 390x844 (touch), waits for the map canvas,
// fails on page errors or on an inline-script CSP block (the u-081 regression). Writes a screenshot.
// Usage: BASE=http://127.0.0.1:8099 node scripts/e2e/phone-smoke.mjs [out.png]
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:8099";
const out = process.argv[2] ?? "phone-smoke.png";
const browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errors = [];
const cspInline = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy/i.test(t) && /inline script/i.test(t)) cspInline.push(t.slice(0, 200));
});
const res = await page.goto(`${base}/map`, { waitUntil: "domcontentloaded", timeout: 180_000 });
let canvas = false;
try {
  await page.waitForSelector("canvas", { timeout: 170_000 });
  canvas = true;
} catch {
  canvas = false;
}
await page.waitForTimeout(8000);
await page.screenshot({ path: out });
const ok = res?.status() === 200 && canvas && !errors.length && !cspInline.length;
console.log(JSON.stringify({ status: res?.status(), canvas, errors, cspInline, ok }));
await browser.close();
process.exit(ok ? 0 : 1);
