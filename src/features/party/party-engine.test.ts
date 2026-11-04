import { describe, expect, it } from "vitest";
import { partyOutcomes } from "./party-catalog";
import { calculateSpinTarget, getSegmentIndexAtPointer, selectRandomIndex } from "../wheel/engine/wheel-engine";
const PARTY_OUTCOME_COUNT = 6;

describe("party mystery wheel", () => {
  it("has six distinct, complete local outcomes", () => {
    expect(PARTY_OUTCOME_COUNT).toBe(6);
    expect(new Set(partyOutcomes.map((outcome) => outcome.id)).size).toBe(6);
    for (const outcome of partyOutcomes) {
      expect(outcome.steps.length).toBeGreaterThanOrEqual(3);
      expect(outcome.steps.length).toBeLessThanOrEqual(5);
      expect(outcome.image).toMatch(/^(?:data:image\/svg\+xml|\/.*\.svg)/);
      expect(outcome.alt.length).toBeGreaterThan(8);
    }
  });

  it("rejects the biased remainder of the uint32 range for six outcomes", () => {
    const draws = [2 ** 32 - 1, 5];
    expect(selectRandomIndex(PARTY_OUTCOME_COUNT, () => draws.shift()!)).toBe(5);
    expect(draws).toHaveLength(0);
  });

  it("uses unbiased secure-index mapping and lands each outcome under the pointer", () => {
    for (let index = 0; index < PARTY_OUTCOME_COUNT; index += 1) {
      expect(selectRandomIndex(PARTY_OUTCOME_COUNT, () => index)).toBe(index);
      expect(getSegmentIndexAtPointer(calculateSpinTarget(0, index, PARTY_OUTCOME_COUNT), PARTY_OUTCOME_COUNT)).toBe(index);
    }
  });
});
