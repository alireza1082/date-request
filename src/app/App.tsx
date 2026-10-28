import { useCallback, useRef } from "react";
import { DateWheel } from "../features/wheel/components/DateWheel";
import { useWheelSpin } from "../features/wheel/hooks/useWheelSpin";
import { ResultDialog } from "../features/results/ResultDialog";
import { activities } from "../data/activities";

export function App() {
  const wheelRef = useRef<HTMLDivElement>(null);
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const wheel = useWheelSpin();
  const { spin: spinWheel, clearResult: clearWheelResult } = wheel;
  const selectedActivity = wheel.selectedIndex === null ? null : activities[wheel.selectedIndex] ?? null;

  const startSpin = useCallback(() => {
    spinWheel(wheelRef.current, activities.length);
  }, [spinWheel]);

  const dismissResult = useCallback(() => {
    clearWheelResult();
    window.requestAnimationFrame(() => spinButtonRef.current?.focus());
  }, [clearWheelResult]);

  const spinAgain = useCallback(() => {
    clearWheelResult();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => startSpin()));
  }, [clearWheelResult, startSpin]);

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="چرخِ قرار، رفتن به آغاز صفحه">
          <span className="brand-mark" aria-hidden="true"><span>♥</span></span>
          <span className="brand-copy">
            <strong>چرخِ قرار</strong>
            <small>DATE WHEEL</small>
          </span>
        </a>
        <div className="header-note">
          <span className="header-note-star" aria-hidden="true">✳</span>
          <span>یه بهونه برای باهم‌بودن</span>
        </div>
      </header>

      <main id="top" className="main-content">
        <section className="experience" aria-labelledby="page-title">
          <div className="intro-copy">
            <p className="eyebrow"><span aria-hidden="true">✦</span> برای قرارِ بعدیِ ما</p>
            <h1 id="page-title">امشب،<br /><span>انتخاب با دلِ ما.</span></h1>
            <p className="intro-description">
              وقتی هر دو می‌گیم «هرچی تو بگی»،<br className="desktop-break" /> این چرخ یه پیشنهادِ قشنگ داره.
            </p>
            <div className="intro-detail">
              <span className="detail-line" aria-hidden="true" />
              <span>ده تا فکرِ دوست‌داشتنی، یک قرارِ دونفره</span>
            </div>
            <div className="intro-stamp" aria-hidden="true">
              <span>هرجا<br />با تو</span>
              <span className="stamp-heart">♥</span>
            </div>
          </div>

          <div className="wheel-column">
            <div className="wheel-topline">
              <span><i aria-hidden="true" /> نوبتِ توئه</span>
              <span className="wheel-count" aria-label="ده پیشنهاد برای قرار">
                <strong>۱۰</strong><span>پیشنهادِ قرار</span>
              </span>
            </div>
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

        <div className="bottom-note" aria-hidden="true">
          <span>هر نتیجه‌ای که بیاد، با تو قشنگه</span>
          <span className="bottom-note-flower">✿</span>
          <span className="bottom-note-dot" />
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {selectedActivity ? `قرارِ انتخاب‌شده: ${selectedActivity.title}` : ""}
        </p>
      </main>

      <footer className="site-footer">
        <span>ساخته‌شده با کمی عشق</span>
        <span aria-hidden="true">♥</span>
        <span>و کلی فکرِ دونفره</span>
      </footer>

      <ResultDialog activity={selectedActivity} onDismiss={dismissResult} onSpinAgain={spinAgain} />
    </div>
  );
}
