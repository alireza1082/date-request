import { afterEach, describe, expect, it, vi } from "vitest";
import { createHistorySubmission, HistoryError, submitHistory } from "./history-client";

describe("history client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a minimal opt-in event with secure idempotency material", () => {
    const event = createHistorySubmission({
      activityId: "cafe", activityTitle: "کافه‌گردی", moodId: "calm",
      displayName: "  همراه  ", invitationTitle: "نادیده", invitationUsed: false,
    });
    expect(event).toMatchObject({
      consent: true, activity_id: "cafe", mood_id: "calm", display_name: "همراه",
      invitation_used: false, invitation_title: "",
    });
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.event_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(event).not.toHaveProperty("ip");
    expect(event).not.toHaveProperty("user_agent");
  });

  it("does not attach names and invitation titles when the visitor is a guest", () => {
    const event = createHistorySubmission({
      activityId: "cafe", activityTitle: "کافه‌گردی", moodId: "surprise",
      displayName: "", invitationTitle: "دعوت", invitationUsed: false,
    });
    expect(event.display_name).toBeNull();
    expect(event.invitation_title).toBe("");
  });

  it("submits only to the same-origin history endpoint and validates acceptance", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response('{"recorded":true,"duplicate":false}', { status: 202 }));
    const event = createHistorySubmission({
      activityId: "cafe", activityTitle: "کافه‌گردی", moodId: "calm",
      displayName: "", invitationTitle: "", invitationUsed: false,
    });
    await submitHistory(event);
    expect(fetchSpy).toHaveBeenCalledWith("/api/history", expect.objectContaining({
      method: "POST", credentials: "same-origin", cache: "no-store", body: JSON.stringify(event),
    }));
  });

  it("rejects unsuccessful or malformed API responses without exposing response details", async () => {
    const event = createHistorySubmission({
      activityId: "cafe", activityTitle: "کافه‌گردی", moodId: "calm",
      displayName: "", invitationTitle: "", invitationUsed: false,
    });
    vi.spyOn(window, "fetch").mockResolvedValue(new Response('{"detail":"private database error"}', { status: 503 }));
    await expect(submitHistory(event)).rejects.toBeInstanceOf(HistoryError);
    vi.spyOn(window, "fetch").mockResolvedValue(new Response('{"ok":true}', { status: 202 }));
    await expect(submitHistory(event)).rejects.toBeInstanceOf(HistoryError);
  });
});
