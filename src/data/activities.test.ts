import { describe, expect, it } from "vitest";
import { activities } from "./activities";

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(first: string, second: string): number {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("date activity data", () => {
  it("has unique identifiers and concise wheel labels", () => {
    expect(new Set(activities.map(({ id }) => id)).size).toBe(activities.length);
    expect(activities.every(({ title, wheelLabel, description }) => title && wheelLabel && description)).toBe(true);
  });

  it("keeps every segment label at or above 4.5:1 contrast", () => {
    for (const activity of activities) {
      const textColor = activity.ink === "light" ? "#fff9ef" : "#503a3b";
      expect(contrastRatio(activity.color, textColor), activity.title).toBeGreaterThanOrEqual(4.5);
    }
  });
});
