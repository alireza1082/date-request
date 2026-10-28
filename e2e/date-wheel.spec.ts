import { expect, test, type Page } from "@playwright/test";

async function inspectWheelLanding(page: Page) {
  return page.evaluate(() => {
    const rotor = document.querySelector<HTMLElement>("[data-wheel-rotor]");
    const result = document.querySelector<HTMLElement>("[data-result-title]");
    if (!rotor || !result) throw new Error("The landed wheel or result card is missing.");
    const transform = new DOMMatrixReadOnly(getComputedStyle(rotor).transform);
    const rotation = (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
    const pointerAngleInWheel = ((-rotation % 360) + 360) % 360;
    const segmentCount = Number(rotor.dataset.segmentCount);
    const segmentIndex = Math.floor(pointerAngleInWheel / (360 / segmentCount));
    const segment = rotor.querySelectorAll<SVGPathElement>("[data-wheel-segment]")[segmentIndex];
    return {
      resultId: result.dataset.resultTitle,
      resultTitle: result.textContent?.trim(),
      visibleSegmentId: segment?.dataset.wheelSegment,
      visibleSegmentTitle: segment?.dataset.wheelTitle,
      segmentCount,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __wheelDrawCount?: number; __sharedMessage?: string };
    testWindow.__wheelDrawCount = 0;
    Object.defineProperty(window.crypto, "getRandomValues", {
      configurable: true,
      value: (values: Uint32Array) => {
        values[0] = 3;
        testWindow.__wheelDrawCount = (testWindow.__wheelDrawCount ?? 0) + 1;
        return values;
      },
    });
  });
});

test("renders Persian RTL without horizontal overflow at target widths", async ({ page }) => {
  for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const layout = await page.evaluate(() => {
      const wheel = document.querySelector(".wheel-frame");
      if (!wheel) throw new Error("Wheel frame is missing.");
      const bounds = wheel.getBoundingClientRect();
      return {
        direction: document.documentElement.dir,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        wheelLeft: bounds.left,
        wheelRight: bounds.right,
      };
    });

    expect(layout.direction).toBe("rtl");
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.wheelLeft).toBeGreaterThanOrEqual(0);
    expect(layout.wheelRight).toBeLessThanOrEqual(width);
    await expect(page.getByRole("heading", { name: /امروز کجا بریم/ })).toBeVisible();
  }
});

test("locks rapid clicks and reveals the activity under the visible pointer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const spinButton = page.getByRole("button", { name: "چرخ را بچرخان" });
  await spinButton.dblclick();
  await expect(page.locator(".hub-button")).toBeDisabled();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  const landing = await page.evaluate(() => {
    const rotor = document.querySelector<HTMLElement>("[data-wheel-rotor]");
    const result = document.querySelector<HTMLElement>("[data-result-title]");
    if (!rotor || !result) throw new Error("The landed wheel or result card is missing.");

    const transform = new DOMMatrixReadOnly(getComputedStyle(rotor).transform);
    const rotation = (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
    const pointerAngleInWheel = ((-rotation % 360) + 360) % 360;
    const segmentCount = Number(rotor.dataset.segmentCount);
    const index = Math.floor(pointerAngleInWheel / (360 / segmentCount));
    const segments = rotor.querySelectorAll<SVGPathElement>("[data-wheel-segment]");
    const segmentUnderPointer = segments[index];
    const labelAngles = Array.from(rotor.querySelectorAll<SVGTextElement>(".wheel-label"), (label) => {
      const matrix = label.getScreenCTM();
      if (!matrix) throw new Error("A wheel label has no screen transform.");
      return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
    });

    return {
      resultId: result.dataset.resultTitle,
      resultTitle: result.textContent?.trim(),
      visibleSegmentId: segmentUnderPointer?.dataset.wheelSegment,
      visibleSegmentTitle: segmentUnderPointer?.dataset.wheelTitle,
      labelAngles,
      randomDrawCount: (window as Window & { __wheelDrawCount?: number }).__wheelDrawCount,
    };
  });

  expect(landing.visibleSegmentId).toBe(landing.resultId);
  expect(landing.visibleSegmentTitle).toBe(landing.resultTitle);
  expect(landing.labelAngles.every((angle) => Math.abs(angle) < 0.1)).toBe(true);
  expect(landing.randomDrawCount).toBe(1);

  await page.getByRole("button", { name: /یه بار دیگه بچرخون/ }).click();
  await expect(dialog).toBeHidden();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as Window & { __wheelDrawCount?: number }).__wheelDrawCount)).toBe(2);
});

test("uses a clipboard message when native sharing is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __sharedMessage?: string };
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (message: string) => {
          testWindow.__sharedMessage = message;
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "چرخ را بچرخان" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "اشتراک‌گذاری" }).click();

  await expect(page.locator(".share-feedback")).toContainText("کپی شد");
  const message = await page.evaluate(() => (window as Window & { __sharedMessage?: string }).__sharedMessage);
  expect(message).toContain("شامِ دونفره");
  expect(message).toContain("http://127.0.0.1:4173/");
});

test("supports keyboard dismissal and returns focus to the wheel", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const spinButton = page.getByRole("button", { name: "چرخ را بچرخان" });
  await spinButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const resultBounds = await page.locator(".result-card").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right };
  });
  expect(resultBounds.left).toBeGreaterThanOrEqual(0);
  expect(resultBounds.right).toBeLessThanOrEqual(320);
  await expect(page.getByRole("button", { name: /قبوله، بریم/ })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".hub-button")).toBeFocused();

  await page.locator(".hub-button").click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /قبوله، بریم/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".hub-button")).toBeFocused();
});

test("rebuilds each mood wheel and keeps the displayed result under its pointer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const label of [/سورپرایزم کن/, /یه چیز آروم/, /بریم بیرون/]) {
      await page.getByRole("radio", { name: label }).click();
      const layout = await page.evaluate(() => {
        const wheel = document.querySelector(".wheel-frame");
        if (!wheel) throw new Error("Wheel is missing.");
        const bounds = wheel.getBoundingClientRect();
        return { scrollWidth: document.documentElement.scrollWidth, width: innerWidth, left: bounds.left, right: bounds.right };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(width);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(width);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });

  for (const [label, count] of [["یه چیز آروم", 5], ["بریم بیرون", 5], ["سورپرایزم کن", 10]] as const) {
    const mood = page.getByRole("radio", { name: new RegExp(label) });
    await mood.click();
    await expect(mood).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-wheel-rotor]")).toHaveAttribute("data-segment-count", String(count));
    await expect(page.locator("[data-wheel-segment]")).toHaveCount(count);
    await page.locator(".hub-button").click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15000 });
    const landing = await inspectWheelLanding(page);
    expect(landing.visibleSegmentId).toBe(landing.resultId);
    expect(landing.visibleSegmentTitle).toBe(landing.resultTitle);
    expect(landing.segmentCount).toBe(count);
    await page.getByRole("button", { name: /قبوله، بریم/ }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 4000 });
  }
});

test("creates a personalized, text-only-safe invitation and opens it as a greeting", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __invitationCopy?: string };
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (message: string) => { testWindow.__invitationCopy = message; } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "یه دعوت کوچولو" }).click();
  const composer = page.getByRole("dialog", { name: "یه سورپرایز کوچولو برات دارم" });
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("عنوان دعوت")).toBeFocused();
  await page.setViewportSize({ width: 320, height: 780 });
  const composerBounds = await composer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, width: innerWidth };
  });
  expect(composerBounds.left).toBeGreaterThanOrEqual(0);
  expect(composerBounds.right).toBeLessThanOrEqual(composerBounds.width);
  await composer.getByLabel("عنوان دعوت").fill("جمعه‌ی دونفره");
  await composer.getByLabel("یه پیام کوچیک بنویس").fill("<img src=x onerror=alert(1)> دلم یه عصر با تو می‌خواد.");
  await composer.getByRole("radio", { name: /بریم بیرون/ }).click();
  await composer.getByRole("button", { name: /ساخت لینک دعوت/ }).click();
  const invitationUrl = await composer.getByLabel("لینک آماده‌ی فرستادن").inputValue();
  expect(invitationUrl).toContain("#invite=");
  await composer.getByRole("button", { name: /بفرست براش/ }).click();
  await expect(composer.locator(".invite-feedback")).toContainText("کپی شد");
  const copiedMessage = await page.evaluate(() => (window as Window & { __invitationCopy?: string }).__invitationCopy);
  expect(copiedMessage).toBe(invitationUrl);
  await composer.getByRole("button", { name: "بستن ساخت دعوت" }).click();
  await expect(composer).toBeHidden();
  await expect(page.getByRole("button", { name: "یه دعوت کوچولو" })).toBeFocused();

  const recipientPage = await page.context().newPage();
  await recipientPage.goto(invitationUrl);
  const greeting = recipientPage.getByRole("dialog", { name: "جمعه‌ی دونفره" });
  await expect(greeting).toBeVisible();
  await expect(greeting.getByRole("button", { name: /بریم سراغ سورپرایز/ })).toBeFocused();
  await expect(greeting.getByText("<img src=x onerror=alert(1)> دلم یه عصر با تو می‌خواد.")).toBeVisible();
  await expect(recipientPage.locator("script[src=x]")).toHaveCount(0);
  await expect(recipientPage.getByRole("radio", { name: /بریم بیرون/ })).toHaveAttribute("aria-checked", "true");
  await greeting.getByRole("button", { name: /بریم سراغ سورپرایز/ }).click();
  await expect(greeting).toBeHidden();
  await expect(recipientPage.locator(".hub-button")).toBeFocused();
  await recipientPage.close();
});

test("handles malformed invitation links without blocking the default wheel", async ({ page }) => {
  await page.goto("/#invite=not-a-valid-token!");
  await expect(page.locator(".invitation-invalid")).toContainText("این لینک دعوت کامل نبود");
  await expect(page.locator(".hub-button")).toBeEnabled();
});

test("exports a crisp postcard PNG and uses text sharing when export fails", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __sharedMessage?: string };
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (message: string) => { testWindow.__sharedMessage = message; } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "چرخ را بچرخان" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ذخیره کارت" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^date-wheel-.+\.png$/);
  await expect(page.locator(".share-feedback")).toContainText("دانلود شد");

  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
  });
  await page.getByRole("button", { name: "اشتراک‌گذاری" }).click();
  await expect(page.locator(".share-feedback")).toContainText("متنِ قرار کپی شد");
  const message = await page.evaluate(() => (window as Window & { __sharedMessage?: string }).__sharedMessage);
  expect(message).toContain("قرارِ بعدی‌مون معلوم شد");
});

test("keeps mood choices locked during a spin and responds immediately to reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const mood = page.getByRole("radio", { name: /یه چیز آروم/ });
  await mood.click();
  await page.locator(".hub-button").click();
  await expect(mood).toBeDisabled();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3000 });
  const landing = await inspectWheelLanding(page);
  expect(landing.visibleSegmentId).toBe(landing.resultId);
});
