import { IntroScreen } from "../features/intro/IntroScreen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MoodId } from "../data/moods";
import { CatalogError, fetchPublicCatalog, type CatalogActivity, type PublicCatalog } from "../data/catalog-api";
import { InvitationComposer } from "../features/invitations/InvitationComposer";
import { InvitationGreeting } from "../features/invitations/InvitationGreeting";
import { MoodSelector } from "../features/invitations/MoodSelector";
import { readInvitationFromLocation } from "../features/invitations/invitation-codec";
import { DateWheel } from "../features/wheel/components/DateWheel";
import { useWheelSpin } from "../features/wheel/hooks/useWheelSpin";
import { ResultDialog } from "../features/results/ResultDialog";
import { VisitorDetails } from "../features/visitor/VisitorDetails";
import { createHistorySubmission, submitHistory, type HistorySubmission } from "../data/history-client";
import { fetchSeasonalSettings, type SeasonalSettings } from "../data/seasonal-settings";
import { HalloweenScreen } from "../features/halloween/HalloweenScreen";

type HistoryUiStatus = "idle" | "saving" | "saved" | "failed";

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
  const [showVisitorDetails, setShowVisitorDetails] = useState(false);
  const [visitorEntryComplete, setVisitorEntryComplete] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [seasonalSettings, setSeasonalSettings] = useState<SeasonalSettings | null>(null);
  const [seasonalLoading, setSeasonalLoading] = useState(false);
  const [seasonalError, setSeasonalError] = useState("");
  const [showHalloween, setShowHalloween] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<HistoryUiStatus>("idle");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [isPreparingSpin, setIsPreparingSpin] = useState(false);
  const [spinSnapshot, setSpinSnapshot] = useState<readonly CatalogActivity[] | null>(null);
  const [spinMood, setSpinMood] = useState<MoodId | null>(null);
  const spinLockRef = useRef(false);
  const historySubmissionRef = useRef<HistorySubmission | null>(null);
  const historyRequestLockRef = useRef(false);
  const displayedMood = spinSnapshot ? spinMood ?? mood : mood;
  const activities = useMemo(() => spinSnapshot ?? catalog?.activities.filter((activity) => activity.moods.includes(displayedMood)) ?? [], [catalog, displayedMood, spinSnapshot]);
  const selectedActivity = wheel.selectedIndex === null ? null : spinSnapshot?.[wheel.selectedIndex] ?? null;
  const activityCount = new Intl.NumberFormat("fa-IR").format(activities.length);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const fresh = await fetchPublicCatalog();
      setCatalog(fresh);
      return fresh;
    } catch (cause) {
      const message = cause instanceof CatalogError ? cause.message : "فهرست قرارها دریافت نشد؛ دوباره تلاش کن.";
      setCatalog(null);
      setCatalogError(message);
      return null;
    } finally { setCatalogLoading(false); }
  }, []);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    if (!showIntro && !showVisitorDetails && !showHalloween && !seasonalLoading && !seasonalError && !isGreetingOpen && catalog && !isPreparingSpin) spinButtonRef.current?.focus({ preventScroll: true });
  }, [catalog, isPreparingSpin, seasonalError, seasonalLoading, showHalloween, showIntro, showVisitorDetails, isGreetingOpen]);

  const startSpin = useCallback(async () => {
    if (spinLockRef.current || wheel.isSpinning) return;
    spinLockRef.current = true;
    setIsPreparingSpin(true);
    setCatalogError("");
    const selectedMood = mood;
    try {
      const fresh = await fetchPublicCatalog();
      const moodDefinition = fresh.moods.find((item) => item.id === selectedMood);
      const active = moodDefinition ? fresh.activities.filter((activity) => moodDefinition.activities.includes(activity.id)) : [];
      if (!moodDefinition || active.length < 2 || active.length > 10) throw new CatalogError("این حال‌وهوا فعلاً چرخِ قابل استفاده‌ای نداره.");
      setCatalog(fresh);
      setSpinMood(selectedMood);
      setSpinSnapshot(active);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      spinWheel(wheelRef.current, active.length);
    } catch (cause) {
      setCatalog(null);
      setSpinSnapshot(null);
      setSpinMood(null);
      setCatalogError(cause instanceof CatalogError ? cause.message : "فهرست قرارها تازه نشد؛ برای ادامه دوباره تلاش کن.");
    } finally {
      spinLockRef.current = false;
      setIsPreparingSpin(false);
    }
  }, [mood, spinWheel, wheel.isSpinning]);

  const dismissResult = useCallback(() => {
    clearWheelResult();
    setSpinSnapshot(null);
    setSpinMood(null);
    window.requestAnimationFrame(() => spinButtonRef.current?.focus());
  }, [clearWheelResult]);

  const spinAgain = useCallback(() => {
    clearWheelResult();
    setSpinSnapshot(null);
    setSpinMood(null);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => startSpin()));
  }, [clearWheelResult, startSpin]);

  const changeMood = useCallback((nextMood: MoodId) => {
    if (wheel.isSpinning || isPreparingSpin || nextMood === mood) return;
    clearWheelResult();
    setMood(nextMood);
  }, [clearWheelResult, isPreparingSpin, mood, wheel.isSpinning]);

  const finishGreeting = useCallback(() => {
    setIsGreetingOpen(false);
    setShowVisitorDetails(true);
  }, []);

  const loadSeasonalSettings = useCallback(async () => {
    setSeasonalLoading(true);
    setSeasonalError("");
    setSeasonalSettings(null);
    try {
      const settings = await fetchSeasonalSettings();
      setSeasonalSettings(settings);
      setShowHalloween(settings.halloween_enabled);
    } catch (cause) {
      setSeasonalError(cause instanceof Error ? cause.message : "تنظیمات سورپرایز دریافت نشد؛ دوباره تلاش کن.");
      setShowHalloween(false);
    } finally { setSeasonalLoading(false); }
  }, []);

  const finishVisitorDetails = useCallback((name: string) => {
    setDisplayName(name);
    setShowVisitorDetails(false);
    setVisitorEntryComplete(true);
    void loadSeasonalSettings();
  }, [loadSeasonalSettings]);

  const saveCurrentHistory = useCallback(async () => {
    if (!selectedActivity || !spinMood || historyRequestLockRef.current) return;
    let submission = historySubmissionRef.current;
    try {
      if (!submission) {
        submission = createHistorySubmission({
          activityId: selectedActivity.id,
          activityTitle: selectedActivity.title,
          moodId: spinMood,
          displayName,
          invitationUsed: Boolean(invitationRead.invitation),
          invitationTitle: invitationRead.invitation?.title ?? "",
        });
        historySubmissionRef.current = submission;
      }
    } catch {
      setHistoryStatus("failed");
      return;
    }

    historyRequestLockRef.current = true;
    setHistoryStatus("saving");
    try {
      await submitHistory(submission);
      setHistoryStatus("saved");
    } catch {
      setHistoryStatus("failed");
    } finally {
      historyRequestLockRef.current = false;
    }
  }, [displayName, invitationRead.invitation, selectedActivity, spinMood]);

  useEffect(() => {
    if (!selectedActivity) {
      historySubmissionRef.current = null;
      historyRequestLockRef.current = false;
      setHistoryStatus("idle");
      return;
    }
    void saveCurrentHistory();
  }, [saveCurrentHistory, selectedActivity]);

  const closeComposer = useCallback(() => {
    setIsComposerOpen(false);
    window.requestAnimationFrame(() => inviteButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  if (showIntro) return <IntroScreen onContinue={() => { setShowIntro(false); setShowVisitorDetails(true); }} />;

  if (showVisitorDetails) return <VisitorDetails onContinue={finishVisitorDetails} />;

  if (visitorEntryComplete && seasonalLoading) return <SeasonalSettingsGate loading error="" onRetry={() => void loadSeasonalSettings()} />;
  if (visitorEntryComplete && seasonalError) return <SeasonalSettingsGate loading={false} error={seasonalError} onRetry={() => void loadSeasonalSettings()} onContinue={() => { setVisitorEntryComplete(false); setSeasonalError(""); }} />;
  if (visitorEntryComplete && showHalloween && seasonalSettings) {
    return <HalloweenScreen settings={seasonalSettings} />;
  }

  if (!catalog) return <>
    <CatalogGate loading={catalogLoading} error={catalogError} onRetry={() => void loadCatalog()} />
    <InvitationGreeting invitation={isGreetingOpen ? invitationRead.invitation : null} onContinue={finishGreeting} />
  </>;

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
            <MoodSelector options={catalog.moods} value={mood} onChange={changeMood} disabled={wheel.isSpinning || isPreparingSpin || selectedActivity !== null} />
            <DateWheel
              activities={activities}
              rotation={wheel.rotation}
              isSpinning={wheel.isSpinning}
              isPreparing={isPreparingSpin}
              hasResult={wheel.selectedIndex !== null}
              wheelRef={wheelRef}
              spinButtonRef={spinButtonRef}
              onSpin={startSpin}
            />
            {(wheel.error || catalogError) && <p className="spin-error" role="alert">{wheel.error || catalogError} {catalogError && <button type="button" onClick={() => void loadCatalog()}>دوباره تلاش کن</button>}</p>}
            {isPreparingSpin && <p className="catalog-refresh-note" role="status"><span className="catalog-refresh-spinner" /> دارم تازه‌ترین چرخ رو می‌گیرم…</p>}
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
      <InvitationComposer open={isComposerOpen} defaultMood={mood} moodOptions={catalog.moods} onClose={closeComposer} />
      <ResultDialog
        mood={spinMood ?? mood}
        invitation={invitationRead.invitation}
        activity={selectedActivity}
        historyStatus={historyStatus}
        historyEvent={historyStatus === "saved" && historySubmissionRef.current
          ? { eventId: historySubmissionRef.current.event_id, eventKey: historySubmissionRef.current.event_key }
          : null}
        onRetryHistory={() => void saveCurrentHistory()}
        onDismiss={dismissResult}
        onSpinAgain={spinAgain}
      />
    </div>
  );
}

function CatalogGate({ loading, error, onRetry }: { readonly loading: boolean; readonly error: string; readonly onRetry: () => void }) {
  return <main className="catalog-gate" dir="rtl"><div className="catalog-gate-card">
    <span className="catalog-gate-mark" aria-hidden="true">✳</span>
    <p className="eyebrow">قرارهای تازه‌مون</p>
    <h1>{loading ? "چرخ داره آماده می‌شه…" : "فعلاً به فهرست قرارها نمی‌رسیم"}</h1>
    <p>{loading ? "یه لحظه صبر کن تا پیشنهادهای امروز رو از سرور بگیریم." : error || "ارتباط با فهرست قرارها برقرار نشد."}</p>
    {loading ? <span className="catalog-gate-loading" role="status"><i /> در حال آماده‌سازی</span> : <button className="button button-primary" type="button" onClick={onRetry}>دوباره تلاش کن <span aria-hidden="true">↻</span></button>}
    <a href="/" className="catalog-gate-home">برگشت به آغاز</a>
  </div></main>;
}

function SeasonalSettingsGate({ loading, error, onRetry, onContinue }: { readonly loading: boolean; readonly error: string; readonly onRetry: () => void; readonly onContinue?: () => void }) {
  return <main className="catalog-gate" dir="rtl"><div className="catalog-gate-card">
    <span className="catalog-gate-mark" aria-hidden="true">☾</span>
    <p className="eyebrow">یک دعوتِ کوچک</p>
    <h1>{loading ? "داریم سورپرایز رو آماده می‌کنیم…" : "تنظیمات دعوت فعلاً در دسترس نیست"}</h1>
    <p>{loading ? "چند لحظه صبر کن تا حال‌وهوای امروز رو بگیریم." : error}</p>
    {loading ? <span className="catalog-gate-loading" role="status"><i /> در حال آماده‌سازی</span> : <><button className="button button-primary" type="button" onClick={onRetry}>دوباره تلاش کن <span aria-hidden="true">↻</span></button>{onContinue && <button className="catalog-gate-home" type="button" onClick={onContinue}>ادامه بدون تجربهٔ فصلی</button>}</>}
  </div></main>;
}
