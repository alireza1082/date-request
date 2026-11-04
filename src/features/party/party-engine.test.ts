import { describe, expect, it } from "vitest";
import { bundledPartyArtwork } from "./party-catalog";
import { calculateSpinTarget, getSegmentIndexAtPointer, selectRandomIndex } from "../wheel/engine/wheel-engine";
import { parsePartyCatalog, partyImage, partyTargetSegment, selectPartyOutcome } from "./party-client";
const PARTY_OUTCOME_COUNT = 6;

const scenario = (id: string, artwork_key = "neon-night") => ({
  id, title: "شب دونفره", headline: "امشب، صحنه مال شماست!", description: "یک برنامهٔ تازه برای دو نفر.",
  alt: "تصویر مهمانی دونفره در نور شب", steps: ["آماده‌کردن فضا", "انتخاب موسیقی", "آماده‌کردن نوشیدنی", "شروع برنامه"],
  artwork_key, image_url: null,
});

describe("party mystery wheel", () => {
  it("keeps seven bundled result illustrations available while content is server-managed", () => {
    expect(Object.keys(bundledPartyArtwork)).toHaveLength(7);
    expect(decodeURIComponent(bundledPartyArtwork["dance-and-lights"]!.split(",")[1] ?? "")).toContain("<svg");
  });

  it("validates the public content contract and enforces a single fixed result", () => {
    expect(parsePartyCatalog({ selection_mode: "random", scenarios: [scenario("one"), scenario("two")] }).scenarios).toHaveLength(2);
    expect(parsePartyCatalog({ selection_mode: "fixed", scenarios: [scenario("one")] }).scenarios).toHaveLength(1);
    expect(() => parsePartyCatalog({ selection_mode: "fixed", scenarios: [scenario("one"), scenario("two")] })).toThrow();
    expect(() => parsePartyCatalog({ selection_mode: "random", scenarios: [{ ...scenario("one"), image_url: "https://evil.test/a.png" }] })).toThrow();
    expect(partyImage({ artwork_key: "unknown", image_url: null })).toBe(bundledPartyArtwork["neon-night"]);
  });

  it("maps random pool and fixed outcomes to stable visual segments", () => {
    expect(partyTargetSegment(scenario("sixth"), 6, "random")).toBe(0);
    expect(partyTargetSegment(scenario("fixed-a"), 4, "fixed")).toBe(partyTargetSegment(scenario("fixed-a"), 0, "fixed"));
  });

  it("uniformly selects from the complete enabled pool and honors fixed mode before animation", () => {
    const catalog = parsePartyCatalog({ selection_mode: "random", scenarios: Array.from({ length: 7 }, (_, index) => scenario(`night-${index}`)) });
    const draws = [2 ** 32 - 1, 6];
    const selected = selectPartyOutcome(catalog, () => draws.shift()!);
    expect(selected.outcome.id).toBe("night-6");
    expect(selected.poolIndex).toBe(6);
    expect(selected.segmentIndex).toBe(0);
    expect(draws).toHaveLength(0);
    const fixed = parsePartyCatalog({ selection_mode: "fixed", scenarios: [scenario("chosen-night")] });
    expect(selectPartyOutcome(fixed, () => { throw new Error("fixed mode must not draw a random result"); }).outcome.id).toBe("chosen-night");
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
