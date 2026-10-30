export interface SeasonalSettings {
  readonly halloween_enabled: boolean;
  readonly halloween_title: string;
  readonly halloween_subtitle: string;
  readonly halloween_cta: string;
  readonly halloween_note: string;
}

const textLimits = {
  halloween_title: 80,
  halloween_subtitle: 240,
  halloween_cta: 60,
  halloween_note: 160,
} as const;
const unsafeText = /[<>\u202a-\u202e\u2066-\u2069]|(?:[a-z][a-z0-9+.-]*:\/\/|www\.|javascript:|data:)/i;

export class SeasonalSettingsError extends Error {
  constructor(message = "تنظیمات تجربهٔ فصلی در دسترس نیست.") {
    super(message);
    this.name = "SeasonalSettingsError";
  }
}

export function parseSeasonalSettings(value: unknown): SeasonalSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SeasonalSettingsError();
  const record = value as Record<string, unknown>;
  if (typeof record.halloween_enabled !== "boolean") throw new SeasonalSettingsError("پاسخ تنظیمات تجربهٔ فصلی معتبر نیست.");
  for (const [field, limit] of Object.entries(textLimits) as [keyof typeof textLimits, number][]) {
    const text = record[field];
    if (typeof text !== "string" || text.length > limit || unsafeText.test(text)
      || text.split("").some((character) => {
        const point = character.charCodeAt(0);
        return point < 0x20 || (point >= 0x7f && point <= 0x9f);
      }) || (field !== "halloween_note" && !text.trim())) {
      throw new SeasonalSettingsError("یکی از متن‌های تجربهٔ فصلی قابل نمایش نیست.");
    }
  }
  return {
    halloween_enabled: record.halloween_enabled,
    halloween_title: record.halloween_title as string,
    halloween_subtitle: record.halloween_subtitle as string,
    halloween_cta: record.halloween_cta as string,
    halloween_note: record.halloween_note as string,
  };
}

export async function fetchSeasonalSettings(): Promise<SeasonalSettings> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("/api/settings", {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: controller.signal, headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new SeasonalSettingsError();
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > 8_192) throw new SeasonalSettingsError();
    try { return parseSeasonalSettings(JSON.parse(body) as unknown); }
    catch (error) { if (error instanceof SeasonalSettingsError) throw error; throw new SeasonalSettingsError(); }
  } catch (error) {
    if (error instanceof SeasonalSettingsError) throw error;
    throw new SeasonalSettingsError("ارتباط با تنظیمات سورپرایز برقرار نشد؛ دوباره تلاش کن.");
  } finally { window.clearTimeout(timeout); }
}
