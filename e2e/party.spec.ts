import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const seed = JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8"));
const settings = { party_enabled: true, halloween_enabled: false, halloween_title: "شب هالووین", halloween_subtitle: "یک شب پاییزی", halloween_cta: "بزن بریم", halloween_note: "" };
const titles = ["شب نئون و موسیقی", "سینمای اختصاصی", "کارائوکه دونفره", "شب نقاب و معما", "آشپزخونه سورپرایزی", "رقابت بازی‌های دونفره"];

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
  const landing = await page.locator("[data-party-wheel-rotor]").evaluate(rotor => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(rotor).transform);
    const degrees = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    return Math.floor((((-degrees % 360) + 360) % 360) / 60);
  });
  expect(landing).toBe(3);
  expect(await page.evaluate(() => (window as Window & { __partyDraws?: number }).__partyDraws)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".party-spin-button")).toBeFocused();
});

test("all six local illustrated results work with reduced motion and modal focus containment", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterParty(page);
  for (let index = 0; index < 6; index += 1) {
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
    }
    if ([0, 1, 3].includes(index)) await page.screenshot({ path: `test-results/party-result-${index}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "برگردیم به چرخ" }).click();
    await expect(page.locator(".party-spin-button")).toBeFocused();
  }
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
    await dialog.getByRole("button", { name: "برگردیم به چرخ" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/party-dialog-${width}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "برگردیم به چرخ" }).click();
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
