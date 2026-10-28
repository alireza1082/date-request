import { expect, test } from "@playwright/test";

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
    await expect(page.getByRole("heading", { name: /امشب/ })).toBeVisible();
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

    return {
      resultId: result.dataset.resultTitle,
      resultTitle: result.textContent?.trim(),
      visibleSegmentId: segmentUnderPointer?.dataset.wheelSegment,
      visibleSegmentTitle: segmentUnderPointer?.dataset.wheelTitle,
      randomDrawCount: (window as Window & { __wheelDrawCount?: number }).__wheelDrawCount,
    };
  });

  expect(landing.visibleSegmentId).toBe(landing.resultId);
  expect(landing.visibleSegmentTitle).toBe(landing.resultTitle);
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
