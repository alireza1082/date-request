import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Activity } from "../../data/activities";
import { shareActivity, type ShareOutcome } from "./share-activity";

interface ResultDialogProps {
  readonly activity: Activity | null;
  readonly onDismiss: () => void;
  readonly onSpinAgain: () => void;
}

const shareFeedback: Readonly<Record<Exclude<ShareOutcome, "cancelled">, string>> = {
  shared: "قرارمون با موفقیت به اشتراک گذاشته شد.",
  copied: "متنِ قرار کپی شد؛ حالا بفرستش برای هم‌قراریت ✨",
  failed: "اشتراک‌گذاری انجام نشد. می‌تونی دوباره امتحان کنی.",
};

const RESULT_EXIT_DURATION = 260;
const SPARKLE_COUNT = 8;

export function ResultDialog({ activity, onDismiss, onSpinAgain }: ResultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const spinAgainRef = useRef(false);
  const [shareMessage, setShareMessage] = useState("");
  const [isClosing, setIsClosing] = useState(false);

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

  if (!activity) {
    return <dialog ref={dialogRef} className="result-dialog" />;
  }

  const handleShare = async () => {
    const outcome = await shareActivity(activity);
    if (outcome !== "cancelled") setShareMessage(shareFeedback[outcome]);
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
                "--spark-x": `${Math.cos((index / SPARKLE_COUNT) * Math.PI * 2) * (82 + (index % 2) * 16)}px`,
                "--spark-y": `${Math.sin((index / SPARKLE_COUNT) * Math.PI * 2) * (76 + (index % 2) * 14)}px`,
              } as CSSProperties}
            />
          ))}
        </div>
        <p className="result-kicker">یه فکرِ قشنگ برای قرارِ بعدی</p>
        <div className="result-emoji" aria-hidden="true">{activity.emoji}</div>
        <h2 id="result-title" data-result-title={activity.id}>{activity.title}</h2>
        <p id="result-description" className="result-description">{activity.description}</p>
        <div className="result-rule" aria-hidden="true"><span>✳</span></div>
        <p className="result-note">باقیِ قصه‌اش با ماست.</p>
        <div className="result-actions">
          <button className="button button-primary result-confirm" type="button" autoFocus onClick={requestClose}>
            قبوله، بریم! <span aria-hidden="true">←</span>
          </button>
          <div className="result-secondary-actions">
            <button className="button button-quiet" type="button" onClick={handleSpinAgain}>
              <span aria-hidden="true">↻</span> یه بار دیگه بچرخون
            </button>
            <button className="button button-quiet" type="button" onClick={handleShare}>
              <span aria-hidden="true">↗</span> اشتراک‌گذاری
            </button>
          </div>
        </div>
        <p className="share-feedback" role="status" aria-live="polite">{shareMessage}</p>
      </div>
    </dialog>
  );
}
