import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

interface MockActivity {
  id: string;
  title: string;
  wheelLabel: string;
  description: string;
  suggestion: string;
  icon: string;
  emoji: string;
  color: string;
  ink: "light" | "dark";
  sortOrder: number;
  moods: string[];
  enabled: boolean;
  archived: boolean;
}

interface CatalogSeed {
  readonly activities: readonly Omit<MockActivity, "icon" | "sortOrder" | "moods" | "enabled" | "archived">[];
  readonly moods: readonly { readonly id: string; readonly activities: readonly string[] }[];
}
const catalog = JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8")) as CatalogSeed;

test("admin can create, icon-edit, preview, and reorder a wheel option", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let authenticated = false;
  let notifyRequests = 0;
  let activities: MockActivity[] = catalog.activities.map((activity, sortOrder) => ({
    ...activity,
    icon: activity.id,
    ink: activity.ink === "dark" ? "dark" : "light",
    sortOrder,
    moods: catalog.moods.filter((mood) => mood.activities.includes(activity.id)).map((mood) => mood.id),
    enabled: true,
    archived: false,
  }));

  await page.on("request", (request) => {
    if (request.url().includes("/api/notify") || request.url().includes("/api/history")) notifyRequests += 1;
  });
  await page.route("**/api/admin/auth/csrf", (route) => route.fulfill({ json: { csrf_token: "a".repeat(64) } }));
  await page.route("**/api/admin/auth/me", (route) => route.fulfill({ status: authenticated ? 200 : 401, json: { authenticated } }));
  await page.route("**/api/admin/auth/login", async (route) => { authenticated = true; await route.fulfill({ json: { authenticated: true } }); });
  await page.route("**/api/admin/auth/logout", async (route) => { authenticated = false; await route.fulfill({ json: { authenticated: false } }); });
  await page.route("**/api/admin/icons", (route) => route.fulfill({ json: { icons: [
    { id: "cafe", label: "فنجان قهوه", category: "خوراکی و کافه" },
    { id: "museum", label: "موزه", category: "فرهنگ" },
    { id: "picnic", label: "سبد پیک‌نیک", category: "فضای باز" },
  ] } }));
  await page.route("**/api/admin/activities/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (route.request().method() === "POST" && id === "reorder") {
      const { ids } = route.request().postDataJSON() as { ids: string[] };
      activities = ids.map((activityId, sortOrder) => ({ ...activities.find((item) => item.id === activityId)!, sortOrder }));
      await route.fulfill({ json: { activities } });
      return;
    }
    const index = activities.findIndex((item) => item.id === id);
    if (route.request().method() === "PATCH" && index >= 0) {
      activities[index] = { ...activities[index]!, ...(route.request().postDataJSON() as Partial<MockActivity>) };
      await route.fulfill({ json: activities[index] });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "not found" } });
  });
  await page.route("**/api/admin/activities", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { activities } });
      return;
    }
    const body = route.request().postDataJSON() as Omit<MockActivity, "emoji" | "ink" | "sortOrder" | "archived">;
    const createdActivity: MockActivity = { ...body, emoji: "🏛️", ink: "light", sortOrder: activities.length, archived: false };
    activities = [...activities, createdActivity];
    await route.fulfill({ status: 201, json: createdActivity });
  });

  await page.goto("/admin");
  await page.getByLabel("رمز عبور").fill("test-password");
  await page.getByRole("button", { name: "ورود به پنل" }).click();
  await page.getByRole("button", { name: "قرارها و چرخ" }).click();
  await expect(page.getByRole("heading", { name: "قرارهای روی چرخ" })).toBeVisible();
  await expect(page.locator(".admin-wheel-preview [data-wheel-segment]")).toHaveCount(10);
  await page.screenshot({ path: "test-results/admin-activities-desktop.png", fullPage: true });

  await page.getByRole("button", { name: /افزودن قرار/ }).click();
  await page.getByLabel("شناسهٔ ثابت (انگلیسی)").fill("sunset-walk");
  await page.getByLabel("عنوان قرار").fill("قدم‌زدن کنار غروب");
  await page.getByLabel("برچسب روی چرخ").fill("غروب‌گردی");
  await page.getByLabel("توضیح کوتاه").fill("یک دور آرام زیر نور آخر روز.");
  await page.getByLabel("پیشنهاد کوچولوی این قرار").fill("هر کدوم یک رنگ قشنگ توی آسمون پیدا کنین.");
  await page.getByRole("checkbox", { name: "سورپرایزم کن" }).uncheck();
  await page.getByRole("checkbox", { name: "بریم بیرون" }).check();
  await page.getByPlaceholder("جست‌وجوی آیکون…").fill("موزه");
  await page.locator(".activity-icon-choice").click();
  await expect(page.locator(".activity-icon-choice.is-selected")).toContainText("موزه");
  await page.screenshot({ path: "test-results/admin-activity-editor-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "ذخیرهٔ تغییرها" }).click();
  await expect(page.getByRole("status").filter({ hasText: "به چرخ اضافه شد" })).toBeVisible();
  expect(activities.find((activity) => activity.id === "sunset-walk")).toMatchObject({ id: "sunset-walk", icon: "museum", moods: ["outdoor"] });
  const row = page.locator(".activity-row").filter({ has: page.getByRole("heading", { name: "قدم‌زدن کنار غروب" }) });
  await expect(row.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml/);

  await row.getByRole("button", { name: /ویرایش/ }).click();
  await page.getByLabel("عنوان قرار").fill("پیاده‌روی وقت غروب");
  await page.getByRole("button", { name: "ذخیرهٔ تغییرها" }).click();
  await expect(page.getByRole("heading", { name: "پیاده‌روی وقت غروب" })).toBeVisible();

  const cafeRow = page.locator(".activity-row").filter({ has: page.getByRole("heading", { name: "کافه‌گردی" }) });
  await cafeRow.getByRole("button", { name: "انتقال کافه‌گردی به پایین" }).click();
  await expect(page.locator(".activity-row").first()).toContainText("سینما");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-results/admin-activities-mobile.png", fullPage: true });
  await expect.poll(() => notifyRequests).toBe(0);
});
