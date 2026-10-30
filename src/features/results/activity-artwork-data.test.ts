import { describe, expect, it } from "vitest";
import { activities } from "../../data/activities";
import { getActivityArtworkDataUrl, getActivityArtworkSvg } from "./activity-artwork-data";

describe("local postcard illustrations", () => {
  it("provides a self-contained SVG illustration for every activity", () => {
    for (const activity of activities) {
      const svg = getActivityArtworkSvg(activity);
      expect(svg).toContain("<svg xmlns=\"http://www.w3.org/2000/svg\"");
      expect(svg).not.toContain("<script");
      expect(svg).not.toContain("<image");
      expect(getActivityArtworkDataUrl(activity)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    }
  });

  it("resolves newly managed activities by their approved icon, not their new ID", () => {
    const source = activities[0]!;
    const newActivity = { ...source, id: "a-new-admin-created-date", icon: "museum" };
    expect(getActivityArtworkSvg(newActivity)).toContain("<svg xmlns=\"http://www.w3.org/2000/svg\"");
    expect(getActivityArtworkDataUrl(newActivity)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });
});
