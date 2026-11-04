import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getSegmentIndexAtPointer } from "../src/features/wheel/engine/wheel-engine";

const seed = JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8"));
const settings = { party_enabled: true, halloween_enabled: false, halloween_title: "شب هالووین", halloween_subtitle: "یک شب پاییزی", halloween_cta: "بزن بریم", halloween_note: "" };
const scenarios = [
  ["neon-night", "شب نئون و موسیقی", "neon-night"], ["private-cinema", "سینمای اختصاصی", "private-cinema"],
  ["karaoke", "کارائوکه دونفره", "karaoke"], ["mystery-night", "شب نقاب و معما", "mystery-night"],
  ["surprise-kitchen", "آشپزخونه سورپرایزی", "surprise-kitchen"], ["game-night", "رقابت بازی‌های دونفره", "game-night"],
  ["dance-and-lights", "شب رقص و نور ✨", "dance-and-lights"],
].map(([id, title, artwork_key]) => ({
  id, title, artwork_key, headline: "امشب، صحنه مال شماست!", description: "یه برنامهٔ تازه و خوش‌حال‌کننده برای دو نفر.",
  alt: `تصویر هنری ${title} در فضای شبانه`, image_url: null,
  steps: ["فضای دنج آماده کنید.", "موسیقی محبوب را انتخاب کنید.", "خوراکی و نوشیدنی بدون الکل آماده کنید.", "برنامه را دونفره شروع کنید."],
}));
const titles = scenarios.map((scenario) => scenario.title).filter((title): title is string => typeof title === "string");

async function enterParty(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "بزن بریم!" }).click();
  await page.getByRole("button", { name: "بدون وارد کردن اسم ادامه می‌دم" }).click();
  await expect(page.locator(".party-page")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/catalog", route => route.fulfill({ json: {
    activities: seed.activities.map((activity: { id: string }, sortOrder: number) => ({ ...activity, icon: activity.id, sortOrder, moods: seed.moods.filter((mood: { activities: string[] }) => mood.activities.includes(activity.id)).map((mood: { id: string }) => mood.id) })), moods: seed.moods,
  } }));
  await page.route("**/api/settings", route => route.fulfill({ json: settings }));
  await page.route("**/api/party", route => route.fulfill({ json: { selection_mode: "random", scenarios } }));
  await page.route("**/api/history", () => { throw new Error("Party mode must not fabricate a normal-catalog history event"); });
  await page.route("**/api/notify", () => { throw new Error("Party mode must not send Telegram automatically"); });
  await page.addInitScript(() => {
    const partyWindow = window as Window & { __partyDraw?: number; __partyDraws?: number };
    partyWindow.__partyDraw = 0;
    partyWindow.__partyDraws = 0;
    const original = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: (values: Uint32Array | Uint8Array) => {
      if (!(values instanceof Uint32Array)) return original(values);
      values[0] = partyWindow.__partyDraw ?? 0;
      partyWindow.__partyDraws = (partyWindow.__partyDraws ?? 0) + 1;
      return values;
    } });
  });
});

test("party hides all six outcomes, locks rapid clicks and matches the visible pointer", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await enterParty(page);
  await expect(page.locator("[data-party-segment]")).toHaveCount(6);
  await expect(page.locator(".party-question")).toHaveText(["؟", "؟", "؟", "؟", "؟", "؟"]);
  for (const title of titles) await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  await expect(page.locator(".hub-button,.halloween-screen")).toHaveCount(0);
  await page.evaluate(() => { (window as Window & { __partyDraw?: number }).__partyDraw = 3; });
  await page.locator(".party-spin-button").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click(); });
  await expect(page.locator(".party-spin-button")).toBeDisabled();
  await page.screenshot({ path: "test-results/party-spinning-375.png", animations: "allow" });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("heading", { name: titles[3]!, exact: true })).toBeVisible();
  const rotation = await page.locator("[data-party-wheel-rotor]").evaluate(rotor => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(rotor).transform);
    return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  });
  expect(getSegmentIndexAtPointer(rotation, 6)).toBe(3);
  expect(await page.evaluate(() => (window as Window & { __partyDraws?: number }).__partyDraws)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "مشاهدهٔ دوبارهٔ برنامه" })).toBeFocused();
});

test("all seven API-managed results use bundled art with reduced motion and modal focus containment", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterParty(page);
  for (let index = 0; index < scenarios.length; index += 1) {
    if (index > 0) {
      await page.reload();
      await enterParty(page);
    }
    await page.evaluate(draw => { (window as Window & { __partyDraw?: number }).__partyDraw = draw; }, index);
    await page.locator(".party-spin-button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: titles[index]!, exact: true })).toBeVisible();
    await expect(dialog.locator("li")).toHaveCount(4);
    expect(await dialog.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(dialog.locator("h2")).toBeFocused();
    for (let tab = 0; tab < 5; tab += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await dialog.evaluate(element => { element.scrollTop = 0; });
    if (index === 5) {
      await dialog.locator("img").evaluate((image: HTMLImageElement) => { image.src = "/missing-party-artwork.svg"; });
      await expect(dialog.locator(".party-artwork-fallback")).toBeVisible();
      await page.screenshot({ path: "test-results/party-artwork-fallback-375.png", animations: "disabled" });
    }
    if ([0, 1, 3, 6].includes(index)) await page.screenshot({ path: `test-results/party-result-${index}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "بستن نتیجه" }).click();
    await expect(page.getByRole("button", { name: "مشاهدهٔ دوبارهٔ برنامه" })).toBeFocused();
  }
});

test("an unavailable uploaded illustration falls back to the bundled scenario art", async ({ page }) => {
  await page.route("**/api/party", route => route.fulfill({ json: {
    selection_mode: "random",
    scenarios: scenarios.map((scenario, index) => ({ ...scenario, image_url: index === 0 ? "/api/party/media/00000000-0000-4000-8000-000000000001" : null })),
  } }));
  await page.route("**/api/party/media/**", route => route.fulfill({ status: 404 }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterParty(page);
  await page.locator(".party-spin-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const image = dialog.locator("img");
  await expect.poll(() => image.getAttribute("src")).not.toContain("/api/party/media/");
  expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: "test-results/party-upload-fallback-375.png", animations: "disabled" });
});

test("party wheel and result remain readable without overflow at every target width", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterParty(page);
  for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const wheelBounds = await page.locator(".party-wheel-stage").boundingBox();
    expect(wheelBounds!.width).toBeLessThanOrEqual(340);
    expect(wheelBounds!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `test-results/party-wheel-${width}.png`, fullPage: true, animations: "disabled" });
    await page.locator(".party-spin-button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeLessThan(width);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: "بستن نتیجه" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/party-dialog-${width}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "بستن نتیجه" }).click();
    if (width !== 1440) await enterParty(page);
  }
});

test("party preserves invitation greeting and does not duplicate the standard intro", async ({ page }) => {
  const token = Buffer.from(JSON.stringify({ version: 1, title: "دعوت شبانه", greeting: "شش سورپرایز داریم", mood: "calm" })).toString("base64url");
  await page.goto(`/#invite=${token}`);
  await expect(page.getByRole("dialog", { name: "دعوت شبانه" })).toBeVisible();
  await expect(page.locator(".welcome-screen")).toHaveCount(0);
  await page.getByRole("button", { name: /بریم سراغ سورپرایز/ }).click();
  await page.locator("#visitor-name").fill("همراه");
  await page.getByRole("button", { name: /بریم سراغ سورپرایز/ }).click();
  await expect(page.locator(".party-page")).toBeVisible();
  await expect(page.locator(".halloween-screen,.hub-button")).toHaveCount(0);
});
