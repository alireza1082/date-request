import { describe, expect, it } from "vitest";
import { getActivitiesForMood, moods } from "./moods";
import { getLandingRotation, getSegmentIndexAtPointer, selectRandomIndex } from "../features/wheel/engine/wheel-engine";

describe("mood activity pools", () => {
  it("keeps every mood populated with unique existing activities", () => {
    for (const mood of moods) {
      const options = getActivitiesForMood(mood.id);
      const ids = options.map(({ id }) => id);
      expect(ids.length).toBeGreaterThanOrEqual(5);
      expect(new Set(ids).size).toBe(ids.length);
      expect(options.every(({ suggestion }) => suggestion.length > 0)).toBe(true);
    }
  });

  it("keeps equal random chance and exact pointer alignment for every active wheel", () => {
    for (const mood of moods) {
      const count = getActivitiesForMood(mood.id).length;
      const indices = Array.from({ length: count }, (_, index) => selectRandomIndex(count, () => index));
      expect(indices).toEqual(Array.from({ length: count }, (_, index) => index));
      for (let index = 0; index < count; index += 1) {
        expect(getSegmentIndexAtPointer(getLandingRotation(index, count), count)).toBe(index);
      }
    }
  });
});
