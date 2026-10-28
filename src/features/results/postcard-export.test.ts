import { afterEach, describe, expect, it, vi } from "vitest";
import { activities } from "../../data/activities";
import { createPostcardBlob, wrapCanvasText } from "./postcard-export";

describe("postcard export", () => {
  afterEach(() => vi.restoreAllMocks());

  it("wraps Persian copy without splitting words", () => {
    const context = { measureText: (text: string) => ({ width: text.length * 10 }) } as CanvasRenderingContext2D;
    expect(wrapCanvasText(context, "یه قرارِ قشنگ برای امروز", 90)).toEqual(["یه قرارِ", "قشنگ برای", "امروز"]);
  });

  it("reports unsupported canvas export instead of pretending the image was saved", async () => {
    const originalCreateElement = document.createElement.bind(document);
    const getContext = vi.fn(() => null);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "canvas") return { width: 0, height: 0, getContext } as unknown as HTMLCanvasElement;
      return originalCreateElement(tagName as keyof HTMLElementTagNameMap);
    }) as typeof document.createElement);

    await expect(createPostcardBlob(activities[0]!)).rejects.toThrow("A canvas is not available");
    expect(getContext).toHaveBeenCalledOnce();
  });
});
