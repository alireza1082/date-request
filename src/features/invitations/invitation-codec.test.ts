import { describe, expect, it } from "vitest";
import { createInvitationUrl, decodeInvitation, encodeInvitation, readInvitationFromLocation, validateInvitation } from "./invitation-codec";

describe("personal invitation links", () => {
  it("round-trips Persian greeting, title, and mood through a compact URL token", () => {
    const invitation = { mood: "calm" as const, title: "یه عصر آروم", greeting: "یه سورپرایز کوچولو برات دارم" };
    const token = encodeInvitation(invitation);
    expect(decodeInvitation(token)).toEqual(invitation);

    const url = createInvitationUrl(invitation, "https://example.test/?campaign=unused");
    expect(url).not.toContain("campaign");
    expect(readInvitationFromLocation(new URL(url).hash, url)).toEqual({ invitation, invalid: false });
  });

  it("rejects malformed, oversized, and unknown data safely", () => {
    expect(() => decodeInvitation("<script>")).toThrow();
    expect(() => validateInvitation({ title: "x".repeat(53) })).toThrow(RangeError);
    expect(() => validateInvitation({ greeting: "سلام", secret: "unexpected" })).toThrow(TypeError);
    expect(readInvitationFromLocation("#invite=broken!", "https://example.test/#invite=broken!")).toEqual({
      invitation: null,
      invalid: true,
    });
    expect(readInvitationFromLocation("#other", "https://example.test/#other")).toEqual({ invitation: null, invalid: false });
    const oversizedToken = "a".repeat(901);
    expect(readInvitationFromLocation(`#invite=${oversizedToken}`, `https://example.test/#invite=${oversizedToken}`)).toEqual({
      invitation: null,
      invalid: true,
    });
  });

  it("treats markup and control characters as plain, normalized text", () => {
    const invitation = validateInvitation({ title: "  <img src=x onerror=alert(1)>  ", greeting: "سلام\nدنیا" });
    expect(invitation.title).toBe("<img src=x onerror=alert(1)>");
    expect(invitation.greeting).toBe("سلام دنیا");
    expect(validateInvitation({ title: "جمله\u202eی آزمایشی" }).title).toBe("جمله ی آزمایشی");
  });

  it("enforces the complete share URL size limit", () => {
    expect(() => createInvitationUrl({ mood: "surprise", title: "ی".repeat(52), greeting: "ت".repeat(100) }, `https://example.test/${"a".repeat(800)}`)).toThrow(RangeError);
  });
});
