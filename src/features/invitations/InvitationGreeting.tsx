import { useEffect, useRef } from "react";
import type { InvitationConfig } from "./invitation-codec";

interface InvitationGreetingProps {
  readonly invitation: InvitationConfig | null;
  readonly onContinue: () => void;
}

export function InvitationGreeting({ invitation, onContinue }: InvitationGreetingProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (invitation && dialog && !dialog.open) {
      dialog.showModal();
      continueRef.current?.focus({ preventScroll: true });
    } else if (!invitation && dialog?.open) {
      dialog.close();
    }
  }, [invitation]);

  return (
    <dialog
      ref={dialogRef}
      className="invitation-greeting"
      aria-labelledby="invitation-greeting-title"
      onCancel={(event) => {
        event.preventDefault();
        dialogRef.current?.close();
      }}
      onClose={onContinue}
    >
      <div className="invitation-paper">
        <span className="invitation-sun" aria-hidden="true">✳</span>
        <p className="invitation-kicker">یه سورپرایز کوچولو برات دارم</p>
        <span className="invitation-rule" aria-hidden="true" />
        <h2 id="invitation-greeting-title">{invitation?.title ?? "یه قرارِ کوچولو"}</h2>
        {invitation?.greeting && <p className="invitation-message">{invitation.greeting}</p>}
        <p className="invitation-signature">حالا ببینیم چرخ چه فکری داره…</p>
        <div className="invitation-actions">
          <button ref={continueRef} className="button button-primary" type="button" onClick={() => dialogRef.current?.close()}>
            بریم سراغ سورپرایز <span aria-hidden="true">←</span>
          </button>
          <button className="button button-quiet invitation-skip" type="button" onClick={() => dialogRef.current?.close()}>
            بی‌مقدمه بریم سراغ چرخ
          </button>
        </div>
      </div>
    </dialog>
  );
}
