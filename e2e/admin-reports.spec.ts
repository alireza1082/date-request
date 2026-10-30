import { expect, test } from "@playwright/test";

test("admin dashboard, history filters, seasonal settings, and Telegram diagnostics work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let authenticated = false;
  let savedHalloween = false;
  let validation: "not_checked" | "valid" = "not_checked";
  let telegramAccepted = 0;
  let historyCleared = false;
  const spin = {
    event_id: "c2d34648-006b-4ee8-a7f3-39de38a5d7f1", created_at: "2026-10-31T08:00:00.000Z",
    display_name: "دوست", mood_id: "calm", activity_id: "cafe", activity_title: "کافه‌گردی",
    invitation_used: true, invitation_title: "یه عصر آروم", telegram_status: "not_sent",
    telegram_accepted_at: null, reported_by_visitor: true,
  };
  const stats = () => ({ reported_events: true as const, timezone: "UTC" as const, retention_days: 90,
    total_spins: historyCleared ? 0 : 12, today_spins: historyCleared ? 0 : 2,
    last_7_days: historyCleared ? 0 : 7,
    most_selected: historyCleared ? [] : [{ activity_id: "cafe", activity_title: "کافه‌گردی", count: 5 }],
    mood_distribution: historyCleared ? { surprise: 0, calm: 0, outdoor: 0 } : { surprise: 6, calm: 4, outdoor: 2 },
    invitation_spins: historyCleared ? 0 : 3,
    telegram: { not_sent: historyCleared ? 0 : 10, attempted: 0, accepted: telegramAccepted, failed: 0 },
  });
  const settings = () => ({ halloween_enabled: savedHalloween, halloween_title: "یه شب متفاوت در راهه...",
    halloween_subtitle: "لباس مخصوصتو آماده کن؛ قراره یه شب قشنگ بسازیم.", halloween_cta: "آماده‌ام، بزن بریم!", halloween_note: "با حال‌وهوای پاییز." });
  const diagnostic = () => ({ api_operational: true, configured: true, bot_token_configured: true,
    destination_configured: true, bot_validation: validation, bot_validated_at: validation === "valid" ? "2026-10-31T08:30:00Z" : null,
    validation_error: null, last_successful_acceptance: telegramAccepted ? "2026-10-31T08:31:00Z" : null,
    last_failed_attempt: null, last_failure_summary: null, success_count: telegramAccepted, failure_count: 0,
    last_test_at: telegramAccepted ? "2026-10-31T08:31:00Z" : null, read_by_recipient: null,
    delivery_semantics: "Telegram API acceptance is confirmed; recipient reading is not observable." });

  await page.route("**/api/admin/auth/csrf", (route) => route.fulfill({ json: { csrf_token: "c".repeat(64) } }));
  await page.route("**/api/admin/auth/me", (route) => route.fulfill({ status: authenticated ? 200 : 401, json: { authenticated } }));
  await page.route("**/api/admin/auth/login", async (route) => { authenticated = true; await route.fulfill({ json: { authenticated: true } }); });
  await page.route("**/api/admin/auth/logout", async (route) => { authenticated = false; await route.fulfill({ json: { authenticated: false } }); });
  await page.route("**/api/admin/activities", (route) => route.fulfill({ json: { activities: [
    { id: "cafe", title: "کافه‌گردی", enabled: true, archived: false },
    { id: "cinema", title: "سینما", enabled: true, archived: false },
  ] } }));
  await page.route("**/api/admin/history/stats", (route) => route.fulfill({ json: stats() }));
  await page.route("**/api/admin/history?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const filtered = historyCleared ? [] : [spin];
    return route.fulfill({ json: { items: filtered, total: historyCleared ? 0 : 1, page_size: 20, offset: Number(query.get("offset") || 0), reported_events: true, retention_days: 90 } });
  });
  await page.route("**/api/admin/history", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().headers()["x-csrf-token"]).toBe("c".repeat(64));
    expect(route.request().postDataJSON()).toEqual({ confirmation: "CLEAR_HISTORY" });
    historyCleared = true;
    await route.fulfill({ json: { deleted: 1 } });
  });
  await page.route("**/api/admin/settings", async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().headers()["x-csrf-token"]).toBe("c".repeat(64));
      savedHalloween = (route.request().postDataJSON() as { halloween_enabled: boolean }).halloween_enabled;
    }
    await route.fulfill({ json: settings() });
  });
  await page.route("**/api/admin/telegram/diagnostics", (route) => route.fulfill({ json: diagnostic() }));
  await page.route("**/api/admin/telegram/validate", async (route) => { expect(route.request().headers()["x-csrf-token"]).toBe("c".repeat(64)); validation = "valid"; await route.fulfill({ json: { validated: true } }); });
  await page.route("**/api/admin/telegram/test", async (route) => { expect(route.request().headers()["x-csrf-token"]).toBe("c".repeat(64)); telegramAccepted += 1; await route.fulfill({ json: { accepted: true, read_by_recipient: null } }); });

  await page.goto("/admin");
  await page.getByLabel("رمز عبور").fill("test-password");
  await page.getByRole("button", { name: "ورود به پنل" }).click();
  await expect(page.locator(".admin-stat-card").first().locator("strong")).toHaveText("۱۲");
  await expect(page.getByText("کافه‌گردی").first()).toBeVisible();
  await page.screenshot({ path: "test-results/admin-dashboard-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "تاریخچه" }).first().click();
  await expect(page.getByRole("heading", { name: "ردّ قرارهای چرخ" })).toBeVisible();
  await expect(page.getByText("«یه عصر آروم»")).toBeVisible();
  await page.getByLabel("حال‌وهوا").selectOption("calm");
  await page.getByRole("button", { name: "اعمال فیلتر" }).click();
  await expect(page.getByRole("heading", { name: "ردّ قرارهای چرخ" })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-history-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-results/admin-history-mobile.png", fullPage: true });
  await expect(page.locator(".admin-history-card")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "پاک‌کردن تاریخچه" }).click();
  await expect(page.getByRole("status").filter({ hasText: "۱ نتیجه پاک شد" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "هنوز نتیجه‌ای اینجا نیست" })).toBeVisible();

  await page.getByRole("button", { name: "تنظیمات" }).first().click();
  await expect(page.getByRole("heading", { name: "شب هالووین" })).toBeVisible();
  await page.getByLabel("فعال‌کردن تجربهٔ هالووین").check();
  await expect(page.locator(".admin-halloween-preview")).toContainText("لباس مخصوصتو آماده کن");
  await page.getByRole("button", { name: "ذخیرهٔ تنظیمات" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تنظیمات ذخیره شد" })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-settings-mobile.png", fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "بررسی اعتبار ربات" }).click();
  await expect(page.getByText("تلگرام توکن ربات رو معتبر شناخت.")).toBeVisible();
  await page.getByRole("button", { name: "ارسال پیام تست" }).click();
  await expect(page.getByText(/تلگرام درخواست پیام آزمایشی رو پذیرفت/)).toBeVisible();
  await page.screenshot({ path: "test-results/admin-settings-desktop.png", fullPage: true });
  expect(telegramAccepted).toBe(1);
  expect(savedHalloween).toBe(true);
});
