import { expect, test } from "@playwright/test";

test("admin login uses the CSRF challenge, protects navigation, and logs out", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let authenticated = false;
  await page.route("**/api/admin/auth/csrf", (route) => route.fulfill({ json: { csrf_token: "a".repeat(64) } }));
  await page.route("**/api/admin/auth/me", (route) => route.fulfill({
    status: authenticated ? 200 : 401,
    json: authenticated ? { authenticated: true } : { detail: "Authentication required." },
  }));
  await page.route("**/api/admin/auth/login", async (route) => {
    authenticated = true;
    await route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/admin/auth/logout", async (route) => {
    authenticated = false;
    await route.fulfill({ json: { authenticated: false } });
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "خوش اومدی، مدیرِ قرارها" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "بخش‌های پنل مدیریت" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/admin-login-mobile.png", fullPage: true });

  await page.getByLabel("رمز عبور").fill("a long test password");
  await page.getByRole("button", { name: "ورود به پنل" }).click();
  await expect(page.getByRole("heading", { name: "از اینجا، چرخِ قرارها رو بچین." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.screenshot({ path: "test-results/admin-shell-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/admin-shell-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "خروج" }).click();
  await expect(page.getByRole("heading", { name: "خوش اومدی، مدیرِ قرارها" })).toBeVisible();
});
