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

export function ResultDialog({ activity, onDismiss, onSpinAgain }: ResultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [shareMessage, setShareMessage] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (activity && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>(".result-confirm")?.focus({ preventScroll: true });
      setShareMessage("");
    } else if (!activity && dialog.open) {
      dialog.close();
    }
  }, [activity]);

  if (!activity) {
    return <dialog ref={dialogRef} className="result-dialog" />;
  }

  const handleShare = async () => {
    const outcome = await shareActivity(activity);
    if (outcome !== "cancelled") setShareMessage(shareFeedback[outcome]);
  };

  const handleDismiss = () => {
    dialogRef.current?.close();
  };

  const handleSpinAgain = () => {
    dialogRef.current?.close();
    onSpinAgain();
  };

  return (
    <dialog
      ref={dialogRef}
      className="result-dialog"
      aria-labelledby="result-title"
      aria-describedby="result-description"
      onClose={onDismiss}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleDismiss();
      }}
    >
      <div className="result-card" style={{ "--result-accent": activity.color } as CSSProperties}>
        <button className="dialog-close" type="button" onClick={handleDismiss} aria-label="بستن نتیجه">
          <span aria-hidden="true">×</span>
        </button>
        <div className="result-sparkles" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => (
            <i
              key={index}
              style={{
                "--spark-index": index,
                "--spark-x": `${Math.cos((index / 14) * Math.PI * 2) * (105 + (index % 3) * 22)}px`,
                "--spark-y": `${Math.sin((index / 14) * Math.PI * 2) * (130 + (index % 2) * 25)}px`,
              } as CSSProperties}
            />
          ))}
        </div>
        <p className="result-kicker">یه فکرِ قشنگ برای قرارِ بعدی</p>
        <div className="result-emoji" aria-hidden="true">{activity.emoji}</div>
        <h2 id="result-title" data-result-title={activity.id}>{activity.title}</h2>
        <p id="result-description" className="result-description">{activity.description}</p>
        <div className="result-rule" aria-hidden="true"><span>✳</span></div>
        <p className="result-note">یه خاطرهٔ تازه منتظرِ ماست.</p>
        <div className="result-actions">
          <button className="button button-primary result-confirm" type="button" autoFocus onClick={handleDismiss}>
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
