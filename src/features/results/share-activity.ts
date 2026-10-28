import type { Activity } from "../../data/activities";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export interface PostcardShareResult {
  readonly outcome: ShareOutcome;
  readonly usedImage: boolean;
}

export function getShareMessage(activity: Activity): string {
  return `قرارِ بعدی‌مون معلوم شد: ${activity.title} ${activity.emoji}\n${activity.description}\n\nتو هم بیا: ${window.location.href}`;
}

export async function shareActivity(activity: Activity): Promise<ShareOutcome> {
  const text = getShareMessage(activity);
  const shareData: ShareData = {
    title: "قرارِ بعدیِ ما",
    text,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
    }
  }

  try {
    if (!navigator.clipboard?.writeText) return "failed";
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

export async function sharePostcard(activity: Activity, file: File): Promise<PostcardShareResult> {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: "یه کارتِ کوچولو برای قرارمون", text: getShareMessage(activity), files: [file] });
      return { outcome: "shared", usedImage: true };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { outcome: "cancelled", usedImage: true };
      }
    }
  }

  return { outcome: await shareActivity(activity), usedImage: false };
}
