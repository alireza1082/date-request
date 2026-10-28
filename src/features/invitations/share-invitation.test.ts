import { afterEach, describe, expect, it, vi } from "vitest";
import { shareInvitationLink } from "./share-invitation";

afterEach(() => vi.unstubAllGlobals());

describe("invitation sharing", () => {
  it("uses native sharing when it succeeds", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await expect(shareInvitationLink("https://example.test/#invite=abc")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.test/#invite=abc" }));
  });

  it("copies the link when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(shareInvitationLink("https://example.test/#invite=abc")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://example.test/#invite=abc");
  });

  it("leaves native share cancellation as cancellation", async () => {
    const writeText = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    await expect(shareInvitationLink("https://example.test/#invite=abc")).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not report a copy when clipboard and browser copy both fail", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await expect(shareInvitationLink("https://example.test/#invite=abc")).resolves.toBe("failed");
  });
});
