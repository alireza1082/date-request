import catalog from "./catalog.json";

export interface Activity {
  readonly id: string;
  readonly title: string;
  readonly wheelLabel: string;
  readonly description: string;
  readonly suggestion: string;
  readonly icon: string;
  readonly emoji: string;
  readonly color: string;
  readonly ink: "light" | "dark";
}

export const activities: readonly Activity[] = catalog.activities.map((activity) => ({
  ...activity,
  icon: activity.id,
  ink: activity.ink === "dark" ? "dark" : "light",
}));
