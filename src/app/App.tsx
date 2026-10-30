import { IntroScreen } from "../features/intro/IntroScreen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActivitiesForMood, type MoodId } from "../data/moods";
import { InvitationComposer } from "../features/invitations/InvitationComposer";
import { InvitationGreeting } from "../features/invitations/InvitationGreeting";
import { MoodSelector } from "../features/invitations/MoodSelector";
import { readInvitationFromLocation } from "../features/invitations/invitation-codec";
import { DateWheel } from "../features/wheel/components/DateWheel";
import { useWheelSpin } from "../features/wheel/hooks/useWheelSpin";
import { ResultDialog } from "../features/results/ResultDialog";

export function App() {
  const wheelRef = useRef<HTMLDivElement>(null);
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const inviteButtonRef = useRef<HTMLButtonElement>(null);
  const wheel = useWheelSpin();
  const { spin: spinWheel, clearResult: clearWheelResult } = wheel;
  const [invitationRead] = useState(() => readInvitationFromLocation(window.location.hash, window.location.href));
  const [mood, setMood] = useState<MoodId>(invitationRead.invitation?.mood ?? "surprise");
  const [isGreetingOpen, setIsGreetingOpen] = useState(Boolean(invitationRead.invitation));
  const [showIntro, setShowIntro] = useState(!invitationRead.invitation);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const activities = useMemo(() => getActivitiesForMood(mood), [mood]);
  const selectedActivity = wheel.selectedIndex === null ? null : activities[wheel.selectedIndex] ?? null;
  const activityCount = new Intl.NumberFormat("fa-IR").format(activities.length);

  useEffect(() => {
    if (!showIntro && !isGreetingOpen) spinButtonRef.current?.focus({ preventScroll: true });
  }, [showIntro, isGreetingOpen]);

  const startSpin = useCallback(() => {
    spinWheel(wheelRef.current, activities.length);
  }, [activities.length, spinWheel]);

  const dismissResult = useCallback(() => {
    clearWheelResult();
    window.requestAnimationFrame(() => spinButtonRef.current?.focus());
  }, [clearWheelResult]);

  const spinAgain = useCallback(() => {
    clearWheelResult();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => startSpin()));
  }, [clearWheelResult, startSpin]);

  const changeMood = useCallback((nextMood: MoodId) => {
    if (wheel.isSpinning || nextMood === mood) return;
    clearWheelResult();
    setMood(nextMood);
  }, [clearWheelResult, mood, wheel.isSpinning]);

  const finishGreeting = useCallback(() => {
    setIsGreetingOpen(false);
    window.requestAnimationFrame(() => spinButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  const closeComposer = useCallback(() => {
    setIsComposerOpen(false);
    window.requestAnimationFrame(() => inviteButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  if (showIntro) return <IntroScreen onContinue={() => setShowIntro(false)} />;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="چرخِ قرار، رفتن به آغاز صفحه">
          <span className="brand-mark" aria-hidden="true"><span>✳</span></span>
          <span className="brand-copy">
            <strong>چرخِ قرار</strong>
            <small>DATE WHEEL</small>
          </span>
        </a>
        <button
          ref={inviteButtonRef}
          className="invite-trigger"
          type="button"
          onClick={() => setIsComposerOpen(true)}
          disabled={wheel.isSpinning}
        >
          <span className="invite-trigger-icon" aria-hidden="true">✉</span>
          <span>یه دعوت کوچولو</span>
        </button>
      </header>

      <main id="top" className="main-content">
        <section className="experience" aria-labelledby="page-title">
          <div className="intro-copy">
            <p className="eyebrow"><span aria-hidden="true">✦</span> برای قرارِ بعدیِ ما</p>
            <h1 id="page-title">خب،<br /><span>امروز کجا بریم؟</span></h1>
            <p className="intro-description">
              وقتی هر دو می‌گیم «هرچی تو بگی»،<br className="desktop-break" /> این چرخ یه پیشنهادِ قشنگ داره.
            </p>
            <div className="intro-detail">
              <span className="detail-line" aria-hidden="true" />
              <span>{activityCount} فکرِ دوست‌داشتنی، یک قرارِ دونفره</span>
            </div>
            <div className="intro-stamp" aria-hidden="true">
              <span>هرجا<br />با تو</span>
              <span className="stamp-heart">✳</span>
            </div>
          </div>

          <div className="wheel-column">
            <div className="wheel-topline">
              <span><i aria-hidden="true" /> نوبتِ توئه</span>
              <span className="wheel-count" aria-label={`${activityCount} پیشنهاد برای قرار`}>
                <strong>{activityCount}</strong><span>پیشنهادِ قرار</span>
              </span>
            </div>
            <MoodSelector value={mood} onChange={changeMood} disabled={wheel.isSpinning || selectedActivity !== null} />
            <DateWheel
              activities={activities}
              rotation={wheel.rotation}
              isSpinning={wheel.isSpinning}
              hasResult={wheel.selectedIndex !== null}
              wheelRef={wheelRef}
              spinButtonRef={spinButtonRef}
              onSpin={startSpin}
            />
            {wheel.error && <p className="spin-error" role="alert">{wheel.error}</p>}
          </div>
        </section>

        {invitationRead.invalid && (
          <p className="invitation-invalid" role="status">این لینک دعوت کامل نبود؛ چرخ آماده‌ست و می‌تونی همین حالا بچرخونیش.</p>
        )}
        <div className="bottom-note" aria-hidden="true">
          <span>هر نتیجه‌ای که بیاد، برنامه با تو قشنگه</span>
          <span className="bottom-note-flower">✿</span>
          <span className="bottom-note-dot" />
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {selectedActivity ? `قرارِ انتخاب‌شده: ${selectedActivity.title}` : ""}
        </p>
      </main>

      <footer className="site-footer">
        <span>ساخته‌شده برای یک قرارِ کوچولو</span>
        <span aria-hidden="true">✳</span>
        <span>با فکرِ دونفره</span>
      </footer>

      <InvitationGreeting invitation={isGreetingOpen ? invitationRead.invitation : null} onContinue={finishGreeting} />
      <InvitationComposer open={isComposerOpen} defaultMood={mood} onClose={closeComposer} />
      <ResultDialog mood={mood} invitation={invitationRead.invitation} activity={selectedActivity} onDismiss={dismissResult} onSpinAgain={spinAgain} />
    </div>
  );
}
