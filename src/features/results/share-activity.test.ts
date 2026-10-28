import { afterEach, describe, expect, it, vi } from "vitest";
import { activities } from "../../data/activities";
import { getShareMessage, shareActivity } from "./share-activity";

const sampleActivity = activities[0]!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sharing a date idea", () => {
  it("builds a Persian message with the selected activity and current link", () => {
    const message = getShareMessage(sampleActivity);

    expect(message).toContain(sampleActivity.title);
    expect(message).toContain(sampleActivity.description);
    expect(message).toContain(window.location.href);
  });

  it("uses the clipboard when Web Share is not available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(shareActivity(sampleActivity)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(sampleActivity.title));
  });

  it("falls back to the clipboard when native sharing fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new Error("share unavailable"));
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });

    await expect(shareActivity(sampleActivity)).resolves.toBe("copied");
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("does not show a false success when both sharing methods fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
    const share = vi.fn().mockRejectedValue(new Error("share unavailable"));
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });

    await expect(shareActivity(sampleActivity)).resolves.toBe("failed");
  });

  it("treats native share cancellation as cancellation", async () => {
    const writeText = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException("dismissed", "AbortError"));
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });

    await expect(shareActivity(sampleActivity)).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });
});
