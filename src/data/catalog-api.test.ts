import { afterEach, describe, expect, it, vi } from "vitest";
import seed from "./catalog.json";
import { CatalogError, fetchPublicCatalog, parsePublicCatalog } from "./catalog-api";

function fixture() {
  return {
    activities: seed.activities.map((activity, sortOrder) => ({
      ...activity,
      icon: activity.id,
      sortOrder,
      moods: seed.moods.filter((mood) => mood.activities.includes(activity.id)).map((mood) => mood.id),
    })),
    moods: seed.moods.map((mood) => ({ ...mood, activities: [...mood.activities] })),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("runtime public activity catalog", () => {
  it("parses the complete API contract in stable server order", () => {
    const parsed = parsePublicCatalog(fixture());
    expect(parsed.activities).toHaveLength(10);
    expect(parsed.activities.map((activity) => activity.sortOrder)).toEqual(Array.from({ length: 10 }, (_, index) => index));
    expect(parsed.activities[0]).toMatchObject({ id: "cafe", icon: "cafe", title: "کافه‌گردی" });
    expect(parsed.activities[0]?.moods).toEqual(expect.arrayContaining(["calm", "surprise"]));
    expect(parsed.moods.find((mood) => mood.id === "outdoor")?.activities).toHaveLength(5);
  });

  it("accepts a newly edited persisted activity without depending on its old ID", () => {
    const changed = fixture();
    const walk = changed.activities.findIndex((activity) => activity.id === "walk");
    changed.activities[walk] = { ...changed.activities[walk]!, id: "moonlight-walk", title: "قدم‌زدن زیر ماه", icon: "museum" };
    for (const mood of changed.moods) mood.activities = mood.activities.map((id) => id === "walk" ? "moonlight-walk" : id);
    const parsed = parsePublicCatalog(changed);
    expect(parsed.activities.find((activity) => activity.id === "moonlight-walk")).toMatchObject({ title: "قدم‌زدن زیر ماه", icon: "museum" });
  });

  it("rejects markup, unknown icons, inconsistent memberships and unusable wheel counts", () => {
    const html = fixture();
    html.activities[0] = { ...html.activities[0]!, title: "<img src=x>" };
    expect(() => parsePublicCatalog(html)).toThrow(CatalogError);

    const icon = fixture();
    icon.activities[0] = { ...icon.activities[0]!, icon: "remote-icon" };
    expect(() => parsePublicCatalog(icon)).toThrow(/قابل نمایش نیست/);

    const mismatch = fixture();
    mismatch.moods[0]!.activities = mismatch.moods[0]!.activities.slice(1);
    expect(() => parsePublicCatalog(mismatch)).toThrow(/هماهنگ نیستند/);

    const tooFew = fixture();
    tooFew.moods[1]!.activities = ["cafe"];
    expect(() => parsePublicCatalog(tooFew)).toThrow(/قابل استفاده نیست/);
  });

  it("fetches same-origin JSON without caching and reports service failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicCatalog()).resolves.toMatchObject({ activities: expect.any(Array) });
    expect(fetchMock).toHaveBeenCalledWith("/api/catalog", expect.objectContaining({ cache: "no-store", credentials: "same-origin", redirect: "error" }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    await expect(fetchPublicCatalog()).rejects.toThrow("فهرست قرارها فعلاً در دسترس نیست.");
  });
});
