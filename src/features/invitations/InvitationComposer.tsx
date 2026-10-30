import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MoodId, MoodOption } from "../../data/moods";
import { createInvitationUrl, MAX_INVITATION_GREETING_LENGTH, MAX_INVITATION_TITLE_LENGTH } from "./invitation-codec";
import { MoodSelector } from "./MoodSelector";
import { shareInvitationLink, type InvitationShareOutcome } from "./share-invitation";

interface InvitationComposerProps {
  readonly open: boolean;
  readonly defaultMood: MoodId;
  readonly onClose: () => void;
  readonly moodOptions?: readonly MoodOption[];
}

const shareMessages: Readonly<Record<Exclude<InvitationShareOutcome, "cancelled">, string>> = {
  shared: "دعوتت آماده شد؛ حالا با خیال راحت بفرستش.",
  copied: "لینک دعوت کپی شد؛ حالا بفرستش برای اون کسی که توی فکری.",
  failed: "کپی لینک انجام نشد؛ می‌تونی لینک رو دستی انتخاب کنی.",
};

export function InvitationComposer({ open, defaultMood, onClose, moodOptions }: InvitationComposerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [greeting, setGreeting] = useState("");
  const [mood, setMood] = useState<MoodId>(defaultMood);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) {
      setMood(defaultMood);
      dialog.showModal();
      window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [defaultMood, open]);

  const close = () => dialogRef.current?.close();

  const handleClose = () => {
    setTitle("");
    setGreeting("");
    setUrl("");
    setMessage("");
    onClose();
  };

  const createLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      const nextUrl = createInvitationUrl({ mood, title, greeting }, window.location.href);
      setUrl(nextUrl);
      setMessage("لینک دعوت آماده‌ست؛ هرکسی این لینک رو داشته باشه، متنش رو می‌بینه.");
    } catch {
      setMessage("یه عنوان یا پیام کوتاه بنویس تا لینک دعوت ساخته بشه.");
    }
  };

  const shareLink = async () => {
    if (!url || isSharing) return;
    setIsSharing(true);
    const outcome = await shareInvitationLink(url);
    setIsSharing(false);
    if (outcome !== "cancelled") setMessage(shareMessages[outcome]);
  };

  return (
    <dialog
      ref={dialogRef}
      className="invite-composer-dialog"
      aria-labelledby="invite-composer-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={handleClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="invite-composer">
        <button className="dialog-close" type="button" onClick={close} aria-label="بستن ساخت دعوت"><span aria-hidden="true">×</span></button>
        <p className="composer-kicker">یک کارت کوچولو، فقط برای اون</p>
        <h2 id="invite-composer-title">یه سورپرایز کوچولو برات دارم</h2>
        <p className="composer-intro">یه جمله از خودت اضافه کن؛ بعد لینک رو بفرست تا دعوتت رو باز کنه.</p>
        <form className="invite-form" onSubmit={createLink}>
          <label htmlFor="invite-title">عنوان دعوت <span>اختیاری</span></label>
          <input
            ref={titleRef}
            id="invite-title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={MAX_INVITATION_TITLE_LENGTH}
            placeholder="مثلاً: جمعه‌ی دونفره"
            autoComplete="off"
          />
          <label htmlFor="invite-greeting">یه پیام کوچیک بنویس <span>اختیاری</span></label>
          <textarea
            id="invite-greeting"
            value={greeting}
            onChange={(event) => setGreeting(event.currentTarget.value)}
            maxLength={MAX_INVITATION_GREETING_LENGTH}
            rows={3}
            placeholder="مثلاً: دلم یه عصر آروم با تو می‌خواد."
          />
          <label>حال‌وهوای قرار</label>
          <MoodSelector value={mood} onChange={setMood} compact {...(moodOptions ? { options: moodOptions } : {})} />
          <p className="invitation-privacy">متن دعوت داخل خودِ لینک قرار می‌گیره؛ هرکسی لینک رو دریافت کنه می‌تونه اون رو ببینه. اسم یا اطلاعات خصوصی ننویس.</p>
          <button className="button button-primary create-invitation" type="submit">ساخت لینک دعوت <span aria-hidden="true">✦</span></button>
        </form>
        {url && (
          <div className="created-invitation">
            <label htmlFor="created-invitation-url">لینک آماده‌ی فرستادن</label>
            <input id="created-invitation-url" dir="ltr" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
            <button className="button button-quiet invite-share-button" type="button" onClick={shareLink} disabled={isSharing}>
              {isSharing ? "یه لحظه…" : "بفرست براش"} <span aria-hidden="true">↗</span>
            </button>
          </div>
        )}
        <p className="invite-feedback" role="status" aria-live="polite">{message}</p>
      </section>
    </dialog>
  );
}
