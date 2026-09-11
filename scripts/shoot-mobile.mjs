import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";

const EXE = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const URL = "http://localhost:7822/";

const env = process.env;
if (!env.DELPHI_MATRICOLA || !env.DELPHI_PASSWORD) {
  console.log("set DELPHI_MATRICOLA and DELPHI_PASSWORD");
  process.exit(0);
}

mkdirSync("shots/mobile", { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill('input[name="matricola"]', env.DELPHI_MATRICOLA);
  await page.fill('input[name="password"]', env.DELPHI_PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/session/login")),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForSelector('[data-drawer-toggle]', { state: "visible", timeout: 60000 });
  await page.waitForTimeout(400);
  return page;
}

async function shoot(page, name) {
  await page.screenshot({ path: `shots/mobile/${name}.png`, fullPage: true });
  console.log("wrote", name);
}

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await login(ctx);

const TAB_VIEWS = ["riepilogo", "esami", "verbali", "pendenti", "piano", "appelli", "tasse", "certificati", "servizi", "anagrafica"];

for (const v of TAB_VIEWS) {
  await page.click(`[data-drawer-toggle]`);
  await page.waitForSelector("[data-drawer]:not([hidden])", { timeout: 10000 });
  await page.click(`[data-drawer] [data-nav="${v}"]`);
  await page.waitForTimeout(900);
  await shoot(page, v);
}

// Shoot the drawer open
await page.click(`[data-drawer-toggle]`);
await page.waitForTimeout(500);
await shoot(page, "drawer-open");
await page.click("[data-drawer-backdrop]");

await browser.close();
