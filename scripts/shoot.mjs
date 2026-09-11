import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

// Visual QA: drive the SPA in light + dark at desktop + mobile and dump PNGs.
// Creds come from the ambient environment (DELPHI_MATRICOLA / DELPHI_PASSWORD)
// — not from .env, which is reserved for server config. Use a one-shot env
// injection when running, e.g.:
//   DELPHI_MATRICOLA=... DELPHI_PASSWORD=... node scripts/shoot.mjs

const EXE = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const URL = "http://localhost:7822/";

const env = process.env;
if (!env.DELPHI_MATRICOLA || !env.DELPHI_PASSWORD) {
  console.log("set DELPHI_MATRICOLA and DELPHI_PASSWORD in the environment, skipping");
  process.exit(0);
}

mkdirSync("shots", { recursive: true });

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
  await page.waitForSelector("[data-app]:not([hidden])", { state: "visible", timeout: 60000 });
  await page.waitForTimeout(300);
  return page;
}

async function goto(page, view) {
  await page.click(`.sidebar [data-nav="${view}"]`);
  await page.waitForTimeout(900);
}

async function shoot(page, name) {
  await page.screenshot({ path: `shots/${name}.png`, fullPage: true });
  console.log("wrote", name);
}

async function loginShot(name, theme = "light") {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript((t) => localStorage.setItem("dw-theme", t), theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await shoot(page, name);
  await ctx.close();
}

const VIEWS = ["riepilogo", "esami", "verbali", "pendenti", "piano", "appelli", "tasse", "certificati", "servizi", "anagrafica"];

await loginShot("login-light", "light");
await loginShot("login-dark", "dark");

// Reuse one authenticated context per viewport. Besides being faster, this
// keeps visual QA from tripping the five-login-per-minute protection.
const desktopCtx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
await desktopCtx.addInitScript(() => localStorage.setItem("dw-theme", "light"));
const desktopPage = await login(desktopCtx);
for (const v of VIEWS) {
  await goto(desktopPage, v);
  await shoot(desktopPage, `${v}-light`);
}
await desktopPage.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
for (const v of ["riepilogo", "esami", "anagrafica", "tasse"]) {
  await goto(desktopPage, v);
  await shoot(desktopPage, `${v}-dark`);
}
await desktopCtx.close();

const mobileCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
await mobileCtx.addInitScript(() => localStorage.setItem("dw-theme", "light"));
const mobilePage = await login(mobileCtx);
for (const v of ["riepilogo", "esami", "tasse"]) {
  await mobilePage.click("[data-drawer-toggle]");
  await mobilePage.click(`[data-drawer] [data-nav="${v}"]`);
  await mobilePage.waitForTimeout(900);
  await shoot(mobilePage, `mobile-${v}`);
}
await mobileCtx.close();

await browser.close();
