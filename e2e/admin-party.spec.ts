import { expect, test } from "@playwright/test";

const titles = ["شب نئون و موسیقی", "سینمای اختصاصی", "کارائوکه دونفره", "شب نقاب و معما", "آشپزخونه سورپرایزی", "رقابت بازی‌های دونفره", "شب رقص و نور ✨"];
const keys = ["neon-night", "private-cinema", "karaoke", "mystery-night", "surprise-kitchen", "game-night", "dance-and-lights"];
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6J8AAAAASUVORK5CYII=";

test("mode switches autosave serially and Party scenario content is editable and fixed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let authenticated = false;
  let mode: "normal" | "party" | "halloween" = "normal";
  let modeVersion = 0;
  let selection: { mode: "random" | "fixed"; fixed_scenario_id: string | null } = { mode: "random", fixed_scenario_id: null };
  let scenarios = keys.map((id, index) => ({
    id, title: titles[index]!, headline: "امشب، صحنه مال شماست!", description: "برنامه‌ای خوش برای دو نفر.",
    alt: "تصویر هنری یک برنامهٔ دونفره در فضای شبانه", steps: ["فضا را آماده کنید.", "موسیقی انتخاب کنید.", "خوراکی آماده کنید.", "برنامه را شروع کنید."],
    artwork_key: id, image_url: null as string | null, enabled: true, sort_order: index, archived: false,
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
  }));

  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/admin/auth/csrf") return route.fulfill({ json: { csrf_token: "a".repeat(64) } });
    if (path === "/api/admin/auth/me") return route.fulfill({ status: authenticated ? 200 : 401, json: { authenticated } });
    if (path === "/api/admin/auth/login") { authenticated = true; return route.fulfill({ json: { authenticated: true } }); }
    if (path === "/api/admin/auth/logout") { authenticated = false; return route.fulfill({ json: { authenticated: false } }); }
    if (path === "/api/admin/settings" && method === "GET") return route.fulfill({ json: {
      halloween_enabled: mode === "halloween", party_enabled: mode === "party", mode_version: modeVersion,
      halloween_title: "یه شب متفاوت در راهه…", halloween_subtitle: "یک دعوت پاییزی.", halloween_cta: "آماده‌ام، بزن بریم!", halloween_note: "",
    } });
    if (path === "/api/admin/settings" && method === "PATCH") return route.fulfill({ json: { halloween_enabled: mode === "halloween", party_enabled: mode === "party", mode_version: modeVersion, halloween_title: "عنوان", halloween_subtitle: "متن", halloween_cta: "بریم", halloween_note: "" } });
    if (path === "/api/admin/mode" && method === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const payload = request.postDataJSON() as { mode: typeof mode; expected_version: number };
      if (payload.expected_version !== modeVersion) return route.fulfill({ status: 409, json: { detail: "Conflict" } });
      mode = payload.mode; modeVersion += 1;
      return route.fulfill({ json: { mode, halloween_enabled: mode === "halloween", party_enabled: mode === "party", mode_version: modeVersion } });
    }
    if (path === "/api/admin/telegram/diagnostics") return route.fulfill({ json: {
      api_operational: true, configured: false, bot_token_configured: false, destination_configured: false,
      bot_validation: "not_checked", bot_validated_at: null, validation_error: null, last_successful_acceptance: null,
      last_failed_attempt: null, last_failure_summary: null, success_count: 0, failure_count: 0,
      last_test_at: null, read_by_recipient: null, delivery_semantics: "Unknown",
    } });
    if (path === "/api/admin/history/stats") return route.fulfill({ json: { reported_events: true, timezone: "UTC", retention_days: 90, total_spins: 0, today_spins: 0, last_7_days: 0, most_selected: [], mood_distribution: { surprise: 0, calm: 0, outdoor: 0 }, invitation_spins: 0, telegram: { not_sent: 0, attempted: 0, accepted: 0, failed: 0 } } });
    if (path === "/api/admin/activities") return route.fulfill({ json: { activities: [] } });
    if (path === "/api/admin/party/scenarios" && method === "GET") return route.fulfill({ json: { scenarios } });
    if (path === "/api/admin/party/scenarios" && method === "POST") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      const created = { ...scenarios[0]!, ...payload, image_url: null, enabled: false, sort_order: scenarios.length };
      scenarios = [...scenarios, created];
      return route.fulfill({ status: 201, json: created });
    }
    if (path === "/api/admin/party/scenarios/reorder" && method === "POST") return route.fulfill({ json: { scenarios } });
    if (path === "/api/admin/party/selection" && method === "GET") return route.fulfill({ json: { ...selection, scenarios } });
    if (path === "/api/admin/party/selection" && method === "PATCH") { selection = request.postDataJSON() as typeof selection; return route.fulfill({ json: { ...selection, scenarios } }); }
    const imageMatch = path.match(/^\/api\/admin\/party\/scenarios\/([^/]+)\/image$/);
    if (imageMatch && method === "POST") {
      const id = imageMatch[1]!;
      scenarios = scenarios.map((item) => item.id === id ? { ...item, image_url: "/api/party/media/123e4567-e89b-42d3-a456-426614174000" } : item);
      return route.fulfill({ json: scenarios.find((item) => item.id === id) });
    }
    const scenarioMatch = path.match(/^\/api\/admin\/party\/scenarios\/([^/]+)$/);
    if (scenarioMatch && method === "PATCH") {
      const id = scenarioMatch[1]!;
      const payload = request.postDataJSON() as Record<string, unknown>;
      scenarios = scenarios.map((item) => item.id === id ? { ...item, ...payload } : item);
      return route.fulfill({ json: scenarios.find((item) => item.id === id) });
    }
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });

  await page.goto("/admin");
  await page.getByLabel("رمز عبور").fill("mocked admin password");
  await page.getByRole("button", { name: "ورود به پنل" }).click();
  await page.getByRole("button", { name: "تنظیمات" }).first().click();
  const partySwitch = page.getByRole("switch", { name: "حالت شب دونفره" });
  const halloweenSwitch = page.getByRole("switch", { name: "حالت هالووین" });
  await partySwitch.check();
  await halloweenSwitch.check();
  await expect.poll(() => mode).toBe("halloween");
  await expect.poll(() => modeVersion).toBe(2);
  await expect(partySwitch).not.toBeChecked();
  await halloweenSwitch.uncheck();
  await expect.poll(() => mode).toBe("normal");
  await expect(page.getByRole("button", { name: "تنظیمات" }).first()).toBeVisible();

  await page.getByRole("button", { name: "سناریوها" }).first().click();
  await expect(page.getByRole("heading", { name: "مدیریت محتوا" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "سناریوهای شب دونفره" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "شب رقص و نور ✨" })).toBeVisible();
  await page.getByRole("button", { name: /ساخت سناریو/ }).click();
  await page.getByLabel("شناسهٔ پایدار").fill("starlight-party");
  await page.getByLabel("عنوان سناریو").fill("شب ستاره‌ای");
  await page.getByLabel("تیتر لحظهٔ آشکارشدن").fill("امشب آسمون نزدیکه!");
  await page.getByLabel("توضیح کوتاه").fill("نورهای نرم و یک برنامهٔ گرم دونفره.");
  await page.getByLabel("توضیح دسترس‌پذیر تصویر").fill("نورهای ستاره‌ای در یک اتاق دنج برای دو نفر");
  for (const [index, value] of ["فضا را آماده کنید.", "موسیقی انتخاب کنید.", "نوشیدنی آماده کنید.", "شب را شروع کنید."].entries()) {
    await page.getByRole("textbox", { name: `مرحلهٔ ${index + 1}` }).fill(value);
  }
  await page.getByLabel("تصویر اختصاصی").setInputFiles({ name: "party.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByLabel("فعال‌شدن پس از ذخیره").check();
  await expect(page.locator(".admin-party-preview-card h5")).toHaveText("شب ستاره‌ای");
  await page.screenshot({ path: "test-results/admin-party-editor.png", fullPage: true });
  await page.getByRole("button", { name: "ذخیره سناریو" }).click();
  await expect(page.getByRole("status").filter({ hasText: "سناریو ذخیره شد" })).toBeVisible();
  await expect.poll(() => scenarios.find((item) => item.id === "starlight-party")?.enabled).toBe(true);
  expect(scenarios.find((item) => item.id === "starlight-party")?.image_url).toContain("/api/party/media/");

  await page.getByLabel("نمایش سناریوی مشخص").check();
  await page.getByLabel("سناریوی ثابت").selectOption("starlight-party");
  await page.screenshot({ path: "test-results/admin-party-fixed-result.png", fullPage: true });
  await page.getByRole("button", { name: "ذخیرهٔ روش انتخاب" }).click();
  await expect.poll(() => selection.mode).toBe("fixed");
  expect(selection.fixed_scenario_id).toBe("starlight-party");
  for (const width of [320, 375, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 820 : 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/admin-party-${width}.png`, fullPage: true, animations: "disabled" });
  }
});
