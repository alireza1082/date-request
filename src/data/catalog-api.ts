import bundledCatalog from "./catalog.json";
import type { Activity } from "./activities";
import type { MoodId, MoodOption } from "./moods";
import { hasLocalActivityIcon } from "../features/results/activity-artwork-data";

export interface CatalogActivity extends Activity {
  readonly sortOrder: number;
  readonly moods: readonly MoodId[];
}
export interface CatalogMood extends MoodOption {
  readonly activities: readonly string[];
}
export interface PublicCatalog {
  readonly activities: readonly CatalogActivity[];
  readonly moods: readonly CatalogMood[];
}

const MOOD_IDS: readonly MoodId[] = ["surprise", "calm", "outdoor"];
const activityIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const safeTextPattern = /[<>\u202a-\u202e\u2066-\u2069]/;
const allowedColors = new Set(bundledCatalog.activities.map((activity) => activity.color));
const MAX_RESPONSE_BYTES = 64 * 1024;

export class CatalogError extends Error {
  constructor(message = "فهرست قرارها دریافت نشد.") {
    super(message);
    this.name = "CatalogError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maxLength && !safeTextPattern.test(value)
    && !value.split("").some((character) => character.charCodeAt(0) < 0x20 || (character.charCodeAt(0) >= 0x7f && character.charCodeAt(0) <= 0x9f))
    && (allowEmpty || value.trim().length > 0);
}
function isMoodId(value: unknown): value is MoodId {
  return typeof value === "string" && MOOD_IDS.includes(value as MoodId);
}

export function parsePublicCatalog(value: unknown): PublicCatalog {
  if (!isRecord(value) || !Array.isArray(value.activities) || !Array.isArray(value.moods)
    || value.activities.length < 2 || value.activities.length > 40 || value.moods.length !== MOOD_IDS.length) {
    throw new CatalogError("ساختار فهرست قرارها با نسخهٔ برنامه سازگار نیست.");
  }

  const ids = new Set<string>();
  const activities = value.activities.map((raw): CatalogActivity => {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length > 32 || !activityIdPattern.test(raw.id)
      || ids.has(raw.id) || !isText(raw.title, 80) || !isText(raw.wheelLabel, 14)
      || !isText(raw.description, 240) || !isText(raw.suggestion, 160)
      || typeof raw.icon !== "string" || !hasLocalActivityIcon(raw.icon)
      || typeof raw.emoji !== "string" || raw.emoji.length > 16
      || typeof raw.color !== "string" || !allowedColors.has(raw.color)
      || (raw.ink !== "light" && raw.ink !== "dark")
      || !Number.isSafeInteger(raw.sortOrder) || (raw.sortOrder as number) < 0
      || !Array.isArray(raw.moods) || raw.moods.length < 1 || raw.moods.length > MOOD_IDS.length
      || !raw.moods.every(isMoodId) || new Set(raw.moods).size !== raw.moods.length) {
      throw new CatalogError("یکی از گزینه‌های فهرست قرارها معتبر یا قابل نمایش نیست.");
    }
    ids.add(raw.id);
    return {
      id: raw.id,
      title: raw.title,
      wheelLabel: raw.wheelLabel,
      description: raw.description,
      suggestion: raw.suggestion,
      icon: raw.icon,
      emoji: raw.emoji,
      color: raw.color,
      ink: raw.ink,
      sortOrder: raw.sortOrder as number,
      moods: raw.moods,
    };
  }).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));

  const moods = value.moods.map((raw): CatalogMood => {
    if (!isRecord(raw)) throw new CatalogError("حال‌وهوای یکی از چرخ‌ها قابل استفاده نیست.");
    const activityIds: unknown = raw.activities;
    const moodId: unknown = raw.id;
    if (!isMoodId(moodId) || !isText(raw.label, 40) || !isText(raw.note, 80)
      || !Array.isArray(activityIds) || activityIds.length < 2 || activityIds.length > 10
      || !activityIds.every((id) => typeof id === "string" && ids.has(id))
      || new Set(activityIds).size !== activityIds.length) {
      throw new CatalogError("حال‌وهوای یکی از چرخ‌ها قابل استفاده نیست.");
    }
    const expectedActivities = activities.filter((activity) => activity.moods.includes(moodId)).map((activity) => activity.id);
    if (expectedActivities.length !== activityIds.length || expectedActivities.some((id, index) => id !== activityIds[index])) {
      throw new CatalogError("فهرست قرارها و حال‌وهواها با هم هماهنگ نیستند.");
    }
    return { id: moodId, label: raw.label, note: raw.note, activities: activityIds as string[] };
  });
  if (new Set(moods.map((mood) => mood.id)).size !== MOOD_IDS.length || MOOD_IDS.some((id) => !moods.some((mood) => mood.id === id))) {
    throw new CatalogError("فهرست حال‌وهواهای چرخ ناقص است.");
  }
  return { activities, moods };
}

export async function fetchPublicCatalog(): Promise<PublicCatalog> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("/api/catalog", {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new CatalogError(response.status >= 500 ? "فهرست قرارها فعلاً در دسترس نیست." : "پاسخ فهرست قرارها معتبر نبود.");
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new CatalogError("فهرست قرارها بزرگ‌تر از حد مجازه.");
    try { return parsePublicCatalog(JSON.parse(body) as unknown); }
    catch (error) { if (error instanceof CatalogError) throw error; throw new CatalogError(); }
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError("ارتباط با فهرست قرارها برقرار نشد؛ دوباره تلاش کن.");
  } finally { window.clearTimeout(timeout); }
}
