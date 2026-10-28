import { activities, type Activity } from "./activities";

export type MoodId = "surprise" | "calm" | "outdoor";

export interface MoodOption {
  readonly id: MoodId;
  readonly label: string;
  readonly note: string;
}

export const moods = [
  { id: "surprise", label: "سورپرایزم کن", note: "از همه‌جور قرار" },
  { id: "calm", label: "یه چیز آروم", note: "دنج و بی‌عجله" },
  { id: "outdoor", label: "بریم بیرون", note: "یه گشتِ تازه" },
] as const satisfies readonly MoodOption[];

const activityIdsByMood: Readonly<Record<MoodId, readonly string[]>> = {
  surprise: activities.map(({ id }) => id),
  calm: ["cafe", "ice-cream", "breakfast", "walk", "bookshop"],
  outdoor: ["cinema", "walk", "picnic", "museum", "bowling"],
};

export function isMoodId(value: unknown): value is MoodId {
  return moods.some((mood) => mood.id === value);
}

export function getActivitiesForMood(moodId: MoodId): readonly Activity[] {
  const allowedIds = new Set(activityIdsByMood[moodId]);
  return activities.filter((activity) => allowedIds.has(activity.id));
}

export function getMoodOption(moodId: MoodId): MoodOption {
  const mood = moods.find(({ id }) => id === moodId);
  if (!mood) throw new RangeError("Unknown date mood.");
  return mood;
}
