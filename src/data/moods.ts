import catalog from "./catalog.json";
import { activities, type Activity } from "./activities";

export type MoodId = "surprise" | "calm" | "outdoor";

export interface MoodOption {
  readonly id: MoodId;
  readonly label: string;
  readonly note: string;
}

export const moods: readonly MoodOption[] = catalog.moods.map((mood) => ({
  ...mood, id: mood.id as MoodId,
}));

const activityIdsByMood = Object.fromEntries(catalog.moods.map((mood) => [mood.id, mood.activities]));

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
