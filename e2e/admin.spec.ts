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
  await page.route("**/api/admin/history/stats", (route) => route.fulfill({ json: {
    reported_events: true, timezone: "UTC", retention_days: 90, total_spins: 12, today_spins: 2,
    last_7_days: 7, most_selected: [{ activity_id: "cafe", activity_title: "کافه‌گردی", count: 5 }],
    mood_distribution: { surprise: 6, calm: 4, outdoor: 2 }, invitation_spins: 3,
    telegram: { not_sent: 10, attempted: 0, accepted: 2, failed: 0 },
  } }));
  await page.route("**/api/admin/activities", (route) => route.fulfill({ json: { activities: [
    { id: "cafe", title: "کافه‌گردی", enabled: true, archived: false },
  ] } }));
  await page.route("**/api/admin/settings", (route) => route.fulfill({ json: {
    halloween_enabled: false, halloween_title: "یه شب متفاوت در راهه...",
    halloween_subtitle: "لباس مخصوصتو آماده کن.", halloween_cta: "آماده‌ام، بزن بریم!", halloween_note: "یه شب قشنگ.",
  } }));
  await page.route("**/api/admin/telegram/diagnostics", (route) => route.fulfill({ json: {
    api_operational: true, configured: false, bot_token_configured: false, destination_configured: false,
    bot_validation: "not_checked", bot_validated_at: null, validation_error: null,
    last_successful_acceptance: null, last_failed_attempt: null, last_failure_summary: null,
    success_count: 0, failure_count: 0, last_test_at: null, read_by_recipient: null,
    delivery_semantics: "Acceptance only.",
  } }));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "خوش اومدی، مدیرِ قرارها" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "بخش‌های پنل مدیریت" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/admin-login-mobile.png", fullPage: true });

  await page.getByLabel("رمز عبور").fill("a long test password");
  await page.getByRole("button", { name: "ورود به پنل" }).click();
  await expect(page.getByRole("heading", { name: "چرخ این روزها چه خبرهایی داشته؟" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.screenshot({ path: "test-results/admin-shell-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/admin-shell-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "خروج" }).click();
  await expect(page.getByRole("heading", { name: "خوش اومدی، مدیرِ قرارها" })).toBeVisible();
});
