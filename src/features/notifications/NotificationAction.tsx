import { useEffect, useRef, useState } from "react";
import type { MoodId } from "../../data/moods";

interface Props {
  readonly activityId: string;
  readonly mood: MoodId;
  readonly invitationTitle: string;
  readonly historyEvent?: { readonly eventId: string; readonly eventKey: string } | null;
}

export function NotificationAction({ activityId, mood, invitationTitle, historyEvent }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const lock = useRef(false);
  const submissionId = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    fetch("/api/status", { signal: controller.signal }).then(async (response) => {
      const data: unknown = await response.json();
      setAvailable(response.ok && typeof data === "object" && data !== null && "notifications_available" in data && data.notifications_available === true);
    }).catch(() => setAvailable(false)).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, []);

  const send = async () => {
    if (!available || lock.current) return;
    lock.current = true;
    setState("sending");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      submissionId.current ??= crypto.randomUUID();
      const response = await fetch("/api/notify", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          activity_id: activityId, mood, invitation_title: invitationTitle, consent: true, submission_id: submissionId.current,
          ...(historyEvent ? { history_event_id: historyEvent.eventId, history_event_key: historyEvent.eventKey } : {}),
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok || typeof data !== "object" || data === null || !("accepted" in data) || data.accepted !== true) throw new Error("Not accepted");
      setState("sent");
    } catch {
      setState("failed");
      lock.current = false;
    } finally { window.clearTimeout(timer); }
  };

  return (
    <div className="notification-action">
      <p id="notification-consent">با زدن این دکمه، نتیجه، حال‌وهوا و عنوان دعوت به تلگرامِ صاحب این سایت فرستاده می‌شه.</p>
      <button className="button button-quiet" type="button" onClick={() => void send()} disabled={!available || state === "sending" || state === "sent"} aria-describedby="notification-consent">
        {state === "sent" ? "نتیجه رسید! 💌" : state === "sending" ? "دارم می‌فرستم…" : "نتیجه رو براش بفرست 💌"}
      </button>
      <p role="status">{state === "failed" ? "ارسال تأیید نشد؛ می‌تونی دوباره امتحان کنی." : available === false ? "ارسال به تلگرام فعلاً در دسترس نیست؛ اشتراک‌گذاری کارت همچنان فعاله." : available === null ? "در حال بررسی امکان ارسال…" : "فقط اگر خودت بخوای، فرستاده می‌شه."}</p>
    </div>
  );
}
