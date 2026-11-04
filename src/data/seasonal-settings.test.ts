import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSeasonalSettings, parseSeasonalSettings, SeasonalSettingsError, resolvePublicMode } from "./seasonal-settings";

const settings = {
  halloween_enabled: true,
  party_enabled: false,
  halloween_title: "امشب یه شب معمولی نیست…",
  halloween_subtitle: "لباس هالووینتو آماده کن؛ یه شب متفاوت در راهه.",
  halloween_cta: "آماده‌ام، بزن بریم!",
  halloween_note: "",
};

describe("public seasonal settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts safe custom copy and keeps the persisted toggle", () => {
    expect(parseSeasonalSettings(settings)).toEqual(settings);
  });

  it("resolves one public mode and rejects conflicting configuration", () => {
    expect(resolvePublicMode(settings)).toBe("halloween");
    expect(resolvePublicMode({ halloween_enabled: false, party_enabled: true })).toBe("party");
    expect(resolvePublicMode({ halloween_enabled: false, party_enabled: false })).toBe("normal");
    expect(() => parseSeasonalSettings({ ...settings, party_enabled: true })).toThrow(SeasonalSettingsError);
    const legacy = { ...settings };
    Reflect.deleteProperty(legacy, "party_enabled");
    expect(parseSeasonalSettings(legacy).party_enabled).toBe(false);
  });

  it.each([
    { ...settings, halloween_enabled: "true" },
    { ...settings, halloween_title: "<script>" },
    { ...settings, halloween_subtitle: "x".repeat(241) },
    { ...settings, halloween_cta: "javascript:alert(1)" },
    { ...settings, halloween_note: 4 },
  ])("rejects malformed or unsafe settings", (value) => {
    expect(() => parseSeasonalSettings(value)).toThrow(SeasonalSettingsError);
  });

  it("loads without cache and reports unavailable API without an off-state fallback", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(settings), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchSeasonalSettings()).resolves.toEqual(settings);
    expect(fetch).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
    fetch.mockResolvedValue(new Response("", { status: 503 }));
    await expect(fetchSeasonalSettings()).rejects.toBeInstanceOf(SeasonalSettingsError);
  });
});
