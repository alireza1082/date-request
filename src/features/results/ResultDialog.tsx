import type { MoodId } from "../../data/moods";
import type { InvitationConfig } from "../invitations/invitation-codec";
import { NotificationAction } from "../notifications/NotificationAction";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Activity } from "../../data/activities";
import { ActivityArtwork } from "./activity-artwork";
import { createPostcardBlob, downloadPostcard } from "./postcard-export";
import { shareActivity, sharePostcard, type ShareOutcome } from "./share-activity";

interface ResultDialogProps {
  readonly mood: MoodId;
  readonly invitation: InvitationConfig | null;
  readonly activity: Activity | null;
  readonly onDismiss: () => void;
  readonly onSpinAgain: () => void;
}

const RESULT_EXIT_DURATION = 260;
const SPARKLE_COUNT = 6;

function getShareFeedback(outcome: ShareOutcome, usedImage = false): string {
  if (outcome === "shared") {
    return usedImage ? "کارتِ قرار با موفقیت به اشتراک گذاشته شد." : "متنِ قرار به اشتراک گذاشته شد.";
  }
  if (outcome === "copied") return "متنِ قرار کپی شد؛ حالا بفرستش برای هم‌قراریت ✨";
  if (outcome === "failed") return "اشتراک‌گذاری انجام نشد؛ می‌تونی دوباره امتحان کنی.";
  return "";
}

export function ResultDialog({ mood, invitation, activity, onDismiss, onSpinAgain }: ResultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const spinAgainRef = useRef(false);
  const actionLockRef = useRef(false);
  const [shareMessage, setShareMessage] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [busyAction, setBusyAction] = useState<"save" | "share" | null>(null);

  const requestClose = () => {
    const dialog = dialogRef.current;
    if (!dialog?.open || closingRef.current) return;

    closingRef.current = true;
    setIsClosing(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : RESULT_EXIT_DURATION;
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      dialog.close();
    }, delay);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (activity && !dialog.open) {
      closingRef.current = false;
      setIsClosing(false);
      setBusyAction(null);
      actionLockRef.current = false;
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>(".result-confirm")?.focus({ preventScroll: true });
      setShareMessage("");
    } else if (!activity && dialog.open) {
      dialog.close();
    }

    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, [activity]);

  if (!activity) return <dialog ref={dialogRef} className="result-dialog" />;

  const runAction = async (action: "save" | "share") => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusyAction(action);
    setShareMessage("");

    try {
      if (action === "save") {
        await downloadPostcard(activity);
        setShareMessage("کارتِ قرار دانلود شد؛ یه یادگاری کوچولو برای بعد.");
      } else {
        try {
          const blob = await createPostcardBlob(activity);
          const file = new File([blob], `date-wheel-${activity.id}.png`, { type: "image/png" });
          const result = await sharePostcard(activity, file);
          setShareMessage(getShareFeedback(result.outcome, result.usedImage));
        } catch {
          const result = await shareActivity(activity);
          if (result === "shared") setShareMessage("ساخت کارت تصویری ممکن نشد؛ متنِ قرار به اشتراک گذاشته شد.");
          else if (result === "copied") setShareMessage("ساخت کارت تصویری ممکن نشد؛ متنِ قرار کپی شد.");
          else if (result === "failed") setShareMessage("ساخت کارت تصویری و اشتراک‌گذاری انجام نشد؛ دوباره امتحان کن.");
          else setShareMessage("کارت تصویری آماده نشد.");
        }
      }
    } catch {
      setShareMessage("ذخیره‌ی کارت انجام نشد؛ می‌تونی متنِ قرار رو به اشتراک بذاری.");
    } finally {
      actionLockRef.current = false;
      setBusyAction(null);
    }
  };

  const handleClosed = () => {
    closingRef.current = false;
    setIsClosing(false);
    const shouldSpinAgain = spinAgainRef.current;
    spinAgainRef.current = false;
    onDismiss();
    if (shouldSpinAgain) onSpinAgain();
  };

  const handleSpinAgain = () => {
    if (busyAction) return;
    spinAgainRef.current = true;
    requestClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={`result-dialog${isClosing ? " is-closing" : ""}`}
      aria-labelledby="result-title"
      aria-describedby="result-description"
      onClose={handleClosed}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="result-card" style={{ "--result-accent": activity.color } as CSSProperties}>
        <button className="dialog-close" type="button" onClick={requestClose} aria-label="بستن نتیجه">
          <span aria-hidden="true">×</span>
        </button>
        <div className="result-sparkles" aria-hidden="true">
          {Array.from({ length: SPARKLE_COUNT }, (_, index) => (
            <i
              key={index}
              style={{
                "--spark-index": index,
                "--spark-x": `${Math.cos((index / SPARKLE_COUNT) * Math.PI * 2) * 64}px`,
                "--spark-y": `${Math.sin((index / SPARKLE_COUNT) * Math.PI * 2) * 64}px`,
              } as CSSProperties}
            />
          ))}
        </div>
        <p className="result-kicker">قرارِ کوچولومون پیدا شد</p>
        <article className="postcard-preview" aria-label={`کارتِ پیشنهادِ ${activity.title}`}>
          <div className="postcard-brand"><span className="postcard-brand-mark" aria-hidden="true">✳</span> چرخِ قرار</div>
          <ActivityArtwork activity={activity} className="result-artwork" />
          <h2 id="result-title" data-result-title={activity.id}>{activity.title}</h2>
          <p id="result-description" className="result-description">{activity.description}</p>
          <div className="postcard-suggestion">
            <span>یه پیشنهادِ کوچولو</span>
            <p>{activity.suggestion}</p>
          </div>
          <span className="postcard-edition">یه یادگاری برای بعد</span>
        </article>
        <div className="result-actions">
          <button className="button button-primary result-confirm" type="button" autoFocus onClick={requestClose}>
            قبوله، بریم! <span aria-hidden="true">←</span>
          </button>
          <div className="result-secondary-actions">
            <button className="button button-quiet" type="button" onClick={() => void runAction("save")} disabled={busyAction !== null}>
              <span aria-hidden="true">↓</span> {busyAction === "save" ? "در حال ساخت…" : "ذخیره کارت"}
            </button>
            <button className="button button-quiet" type="button" onClick={() => void runAction("share")} disabled={busyAction !== null}>
              <span aria-hidden="true">↗</span> {busyAction === "share" ? "یه لحظه…" : "اشتراک‌گذاری"}
            </button>
          </div>
          <button className="button button-repeat" type="button" onClick={handleSpinAgain} disabled={busyAction !== null}>
            یه بار دیگه بچرخون <span aria-hidden="true">↻</span>
          </button>
          {invitation && <NotificationAction key={activity.id} activityId={activity.id} mood={mood} invitationTitle={invitation.title ?? ""} />}
          <p className="share-feedback" role="status" aria-live="polite">{shareMessage}</p>
        </div>
      </div>
    </dialog>
  );
}
