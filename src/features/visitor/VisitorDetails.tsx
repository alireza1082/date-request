import { useState, type FormEvent } from "react";

interface VisitorDetailsProps {
  readonly onContinue: (displayName: string) => void;
}

function sanitizeDisplayName(value: string): string {
  return Array.from(value).filter((character) => {
    const point = character.codePointAt(0) ?? 0;
    return character !== "<" && character !== ">" && point >= 0x20 && !(point >= 0x7f && point <= 0x9f)
      && !(point >= 0x202a && point <= 0x202e) && !(point >= 0x2066 && point <= 0x2069);
  }).slice(0, 32).join("");
}

export function VisitorDetails({ onContinue }: VisitorDetailsProps) {
  const [displayName, setDisplayName] = useState("");

  const continueWithName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onContinue(displayName.trim().slice(0, 32));
  };

  const continueAsGuest = () => {
    setDisplayName("");
    onContinue("");
  };

  return (
    <main className="visitor-screen" dir="rtl">
      <section className="visitor-paper" aria-labelledby="visitor-title">
        <span className="visitor-mark" aria-hidden="true">✳</span>
        <p className="visitor-eyebrow">قبل از شروعِ سورپرایز</p>
        <h1 id="visitor-title">دوست داری با چه اسمی صدات کنیم؟</h1>
        <p className="visitor-intro">اسم یا لقب دلخواهت رو بنویس؛ لازم نیست اسم واقعی باشه.</p>

        <form onSubmit={continueWithName}>
          <label className="visitor-name-label" htmlFor="visitor-name">اسمتو بنویس <span>اختیاری</span></label>
          <input
            id="visitor-name"
            name="displayName"
            type="text"
            autoFocus
            autoComplete="nickname"
            maxLength={32}
            value={displayName}
            onChange={(event) => setDisplayName(sanitizeDisplayName(event.target.value))}
            placeholder="مثلاً «مدیـ»"
            aria-describedby="visitor-privacy-copy"
          />

          <p id="visitor-privacy-copy" className="visitor-privacy-note">
            نتیجهٔ چرخش و نامی که وارد می‌کنی برای صاحب سایت ثبت می‌شه.
          </p>

          <button className="button button-primary visitor-continue" type="submit">بریم سراغ سورپرایز <span aria-hidden="true">←</span></button>
          <button className="visitor-guest" type="button" onClick={continueAsGuest}>بدون وارد کردن اسم ادامه می‌دم</button>
        </form>
      </section>
    </main>
  );
}
