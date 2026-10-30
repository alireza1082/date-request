import type { MoodId } from "./moods";

export interface HistorySubmissionInput {
  readonly activityId: string;
  readonly activityTitle: string;
  readonly moodId: MoodId;
  readonly displayName: string;
  readonly invitationTitle: string;
  readonly invitationUsed: boolean;
}

export interface HistorySubmission {
  readonly event_id: string;
  readonly event_key: string;
  readonly consent: true;
  readonly activity_id: string;
  readonly activity_title: string;
  readonly mood_id: MoodId;
  readonly display_name: string | null;
  readonly invitation_used: boolean;
  readonly invitation_title: string;
}

export class HistoryError extends Error {
  constructor() {
    super("ثبت نتیجه انجام نشد؛ می‌تونی دوباره امتحان کنی.");
    this.name = "HistoryError";
  }
}

function createEventKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function createHistorySubmission(input: HistorySubmissionInput): HistorySubmission {
  const displayName = input.displayName.trim();
  const invitationTitle = input.invitationUsed ? input.invitationTitle.trim() : "";
  return {
    event_id: crypto.randomUUID(),
    event_key: createEventKey(),
    consent: true,
    activity_id: input.activityId,
    activity_title: input.activityTitle,
    mood_id: input.moodId,
    display_name: displayName || null,
    invitation_used: input.invitationUsed,
    invitation_title: invitationTitle,
  };
}

export async function submitHistory(submission: HistorySubmission): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("/api/history", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!response.ok) throw new HistoryError();
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || (result as Record<string, unknown>).recorded !== true) {
      throw new HistoryError();
    }
  } catch {
    throw new HistoryError();
  } finally {
    window.clearTimeout(timeout);
  }
}
