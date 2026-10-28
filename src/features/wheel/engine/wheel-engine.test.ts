import { describe, expect, it, vi } from "vitest";
import {
  calculateSpinTarget,
  getLandingRotation,
  getSegmentAngles,
  getSegmentIndexAtPointer,
  normalizeDegrees,
  selectRandomIndex,
} from "./wheel-engine";

describe("secure selection", () => {
  it("maps every accepted remainder to an equally reachable segment", () => {
    const count = 10;
    const values = Array.from({ length: count }, (_, index) => index);
    const choose = vi.fn(() => values.shift() ?? 0);

    expect(Array.from({ length: count }, () => selectRandomIndex(count, choose))).toEqual(
      Array.from({ length: count }, (_, index) => index),
    );
  });

  it("rejects the uneven tail of the uint32 range before choosing", () => {
    const choose = vi.fn().mockReturnValueOnce(0xffff_ffff).mockReturnValueOnce(17);

    expect(selectRandomIndex(10, choose)).toBe(7);
    expect(choose).toHaveBeenCalledTimes(2);
  });

  it("uses crypto.getRandomValues as its default source", () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 23;
      return array;
    });

    expect(selectRandomIndex(10)).toBe(3);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("rejects invalid counts and invalid random source values", () => {
    expect(() => selectRandomIndex(1, () => 0)).toThrow(RangeError);
    expect(() => selectRandomIndex(10, () => -1)).toThrow(RangeError);
  });
});

describe("wheel geometry and rotation", () => {
  it.each([2, 3, 7, 10, 12, 37])("aligns every segment with the pointer for %i segments", (count) => {
    for (let index = 0; index < count; index += 1) {
      const rotation = getLandingRotation(index, count);
      expect(getSegmentIndexAtPointer(rotation, count)).toBe(index);
    }
  });

  it("creates contiguous, equally sized segment angles", () => {
    const count = 10;
    const segmentSize = 360 / count;
    const first = getSegmentAngles(0, count);
    const last = getSegmentAngles(count - 1, count);

    expect(first.start).toBe(-90);
    expect(first.end).toBeCloseTo(getSegmentAngles(1, count).start);
    expect(last.end).toBe(270);
    expect(first.end - first.start).toBeCloseTo(segmentSize);
  });

  it("keeps the selected segment under the pointer after repeated spins", () => {
    let rotation = 0;
    const firstTarget = calculateSpinTarget(rotation, 8, 10);
    expect(firstTarget).toBeGreaterThan(rotation);
    expect(getSegmentIndexAtPointer(firstTarget, 10)).toBe(8);

    rotation = firstTarget;
    const secondTarget = calculateSpinTarget(rotation, 2, 10);
    expect(secondTarget).toBeGreaterThan(rotation);
    expect(getSegmentIndexAtPointer(secondTarget, 10)).toBe(2);

    const changedWheelTarget = calculateSpinTarget(secondTarget, 5, 7);
    expect(getSegmentIndexAtPointer(changedWheelTarget, 7)).toBe(5);
  });

  it("normalizes negative and large rotations", () => {
    expect(normalizeDegrees(-1)).toBe(359);
    expect(normalizeDegrees(1081)).toBe(1);
  });

  it("rejects invalid angles, indexes, counts, and spin amounts", () => {
    expect(() => normalizeDegrees(Number.NaN)).toThrow(RangeError);
    expect(() => getSegmentAngles(-1, 10)).toThrow(RangeError);
    expect(() => getLandingRotation(0, 1)).toThrow(RangeError);
    expect(() => getSegmentIndexAtPointer(Infinity, 10)).toThrow(RangeError);
    expect(() => calculateSpinTarget(0, 0, 10, 0)).toThrow(RangeError);
  });
});
