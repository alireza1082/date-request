import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { getSegmentAngles } from "../wheel/engine/wheel-engine";
import { useWheelSpin } from "../wheel/hooks/useWheelSpin";
import { bundledPartyArtwork, type PartyCatalog, type PartyOutcome } from "./party-catalog";
import { fetchPartyCatalog, partyImage, selectPartyOutcome } from "./party-client";
import "./party.css";

const SIZE = 420;
const CENTER = SIZE / 2;
const RADIUS = 184;
const LABEL_RADIUS = 125;

function pointAt(radius: number, angle: number) {
  const radians = angle * Math.PI / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

function wedge(start: number, end: number) {
  const first = pointAt(RADIUS, start);
  const last = pointAt(RADIUS, end);
  return `M ${CENTER} ${CENTER} L ${first.x} ${first.y} A ${RADIUS} ${RADIUS} 0 0 1 ${last.x} ${last.y} Z`;
}

export function PartyExperience() {
  const rotorRef = useRef<HTMLDivElement>(null);
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const reopenButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const startedRef = useRef(false);
  const wheel = useWheelSpin();
  const [catalog, setCatalog] = useState<PartyCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [spinError, setSpinError] = useState("");
  const [plannedOutcome, setPlannedOutcome] = useState<PartyOutcome | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [usingBundledFallback, setUsingBundledFallback] = useState(false);
  const outcome = wheel.selectedIndex === null ? null : plannedOutcome;

  const loadScenarios = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const response = await fetchPartyCatalog();
      setCatalog(response);
    } catch (error) {
      setCatalog(null);
      setCatalogError(error instanceof Error ? error.message : "سورپرایزها بارگذاری نشدن؛ دوباره تلاش کن.");
    } finally { setCatalogLoading(false); }
  }, []);

  useEffect(() => { void loadScenarios(); }, [loadScenarios]);
  useEffect(() => {
    if (wheel.error && !wheel.isSpinning) startedRef.current = false;
  }, [wheel.error, wheel.isSpinning]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!outcome || !dialog || dialog.open) return;
    setImageFailed(false);
    setUsingBundledFallback(false);
    dialog.showModal();
    const frame = requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [outcome]);

  const startSpin = () => {
    if (!catalog || catalogLoading || startedRef.current || wheel.isSpinning || wheel.selectedIndex !== null) return;
    startedRef.current = true;
    setSpinError("");
    try {
      const selected = selectPartyOutcome(catalog);
      setPlannedOutcome(selected.outcome);
      wheel.spin(rotorRef.current, 6, selected.segmentIndex);
    } catch {
      startedRef.current = false;
      setSpinError("چرخش امن این‌بار آماده نشد؛ دوباره امتحان کن.");
    }
  };

  const closeResult = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
  };

  const openResult = () => {
    const dialog = dialogRef.current;
    if (!dialog || !outcome || dialog.open) return;
    dialog.showModal();
    titleRef.current?.focus({ preventScroll: true });
  };

  const containDialogFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const image = outcome ? partyImage(outcome) : "";
  const bundledFallback = outcome ? bundledPartyArtwork[outcome.artwork_key] ?? bundledPartyArtwork["neon-night"]! : "";
  const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <main className="party-page" dir="rtl">
      <div className="party-orbit party-orbit-one" aria-hidden="true" />
      <div className="party-orbit party-orbit-two" aria-hidden="true" />
      <header className="party-header">
        <a className="party-brand" href="/" aria-label="چرخ قرار، بازگشت به آغاز"><span aria-hidden="true">✳</span> چرخِ قرار</a>
        <span className="party-mode-chip"><i aria-hidden="true" /> تجربهٔ شب دونفره</span>
      </header>

      <section className="party-content" aria-labelledby="party-title">
        <p className="party-eyebrow"><span aria-hidden="true">✦</span> فقط یکی از این شب‌ها منتظر شماست</p>
        <h1 id="party-title">امشب قراره<br /><span>یه شب متفاوت باشه ✨</span></h1>
        <p className="party-lede">شش تا سورپرایز داریم، ولی فقط یکی قراره برای تو انتخاب بشه!</p>

        {catalogLoading ? <div className="party-catalog-state" role="status"><span className="party-loader" />در حال آماده‌کردن سورپرایزها…</div>
          : catalogError ? <div className="party-catalog-state is-error" role="alert"><p>{catalogError}</p><button type="button" onClick={() => void loadScenarios()}>دوباره تلاش کن</button></div>
            : <>
              <div className="party-wheel-stage">
                <span className="party-pointer" aria-hidden="true"><i /></span>
                <div className="party-wheel-frame">
                  <div
                    ref={rotorRef}
                    className="party-wheel-rotor"
                    data-party-wheel-rotor
                    data-segment-count="6"
                    data-result-index={wheel.selectedIndex ?? ""}
                    data-reduced-motion={reducedMotion}
                    style={{ "--party-rotation": `${wheel.rotation}deg` } as CSSProperties}
                  >
                    <svg className="party-wheel-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-labelledby="party-wheel-title party-wheel-description">
                      <title id="party-wheel-title">چرخ رمزآلود شب دونفره</title>
                      <desc id="party-wheel-description">شش بخش هم‌اندازه با علامت سؤال؛ سناریو از میان {catalog?.scenarios.length ?? 0} برنامهٔ فعال انتخاب می‌شود.</desc>
                      <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="#291d43" />
                      {Array.from({ length: 6 }, (_, index) => {
                        const { start, end, center } = getSegmentAngles(index, 6);
                        const point = pointAt(LABEL_RADIUS, center);
                        return <g key={index}>
                          <path d={wedge(start, end)} className={`party-segment party-segment-${index}`} data-party-segment={index} />
                          <path d={wedge(start, end)} fill="none" stroke="rgba(255,255,255,.52)" strokeWidth="1.5" />
                          <text x={point.x} y={point.y} className="party-question" textAnchor="middle" dominantBaseline="central" aria-hidden="true">؟</text>
                        </g>;
                      })}
                      <circle cx={CENTER} cy={CENTER} r="45" className="party-hub-ring" />
                      <circle cx={CENTER} cy={CENTER} r="36" className="party-hub" />
                      <text x={CENTER} y={CENTER + 2} className="party-hub-star" textAnchor="middle" dominantBaseline="central" aria-hidden="true">✦</text>
                    </svg>
                  </div>
                  <div className="party-wheel-rim" aria-hidden="true" />
                </div>
              </div>

              <button
                ref={spinButtonRef}
                className="party-spin-button"
                type="button"
                disabled={wheel.isSpinning || wheel.selectedIndex !== null}
                aria-busy={wheel.isSpinning}
                onClick={startSpin}
              >
                {wheel.isSpinning ? "سورپرایز داره آماده می‌شه…" : wheel.selectedIndex !== null ? "سورپرایز امشب انتخاب شد ✨" : "بچرخون ببین چی در انتظارته! 🎡"}
              </button>
              <p className="party-wheel-note" aria-live="polite">{wheel.isSpinning ? "چرخ در حال انتخاب سورپرایزته" : catalog?.selection_mode === "fixed" ? "یک برنامهٔ ویژه برای این تجربه انتخاب شده است." : "اسم‌ها تا پایان چرخش یک راز می‌مونن."}</p>
              {(wheel.error || spinError) && <p className="party-wheel-error" role="alert">{spinError || wheel.error}</p>}
              {wheel.selectedIndex !== null && outcome && <div className="party-selected-summary"><span>{outcome.title}</span><button ref={reopenButtonRef} type="button" onClick={openResult}>مشاهدهٔ دوبارهٔ برنامه</button></div>}
            </>}
      </section>

      <footer className="party-footer">شش مسیر برای یک شبِ به‌یادماندنی <span aria-hidden="true">✦</span></footer>

      <dialog
        ref={dialogRef}
        className="party-result-dialog"
        aria-modal="true"
        aria-labelledby="party-result-title"
        aria-describedby="party-result-reveal"
        onKeyDown={containDialogFocus}
        onClose={() => requestAnimationFrame(() => reopenButtonRef.current?.focus({ preventScroll: true }))}
      >
        {outcome && <article className="party-result-card" dir="rtl">
          <button className="party-result-close" type="button" onClick={closeResult} aria-label="بستن نتیجه">×</button>
          <div className="party-artwork-wrap">
            {!imageFailed ? <img className="party-result-artwork" src={usingBundledFallback ? bundledFallback : image} alt={outcome.alt} width="480" height="300" onError={() => {
              if (outcome.image_url && !usingBundledFallback) setUsingBundledFallback(true);
              else setImageFailed(true);
            }} /> : <div className="party-artwork-fallback" role="img" aria-label={outcome.alt}><span className="party-fallback-orbit" aria-hidden="true">✦</span><span className="party-fallback-title" aria-hidden="true">{outcome.title}</span></div>}
            <span className="party-artwork-sheen" aria-hidden="true" />
          </div>
          <div className="party-result-copy">
            <p className="party-result-kicker"><span aria-hidden="true">✧</span> {catalog?.selection_mode === "fixed" ? "برنامهٔ ویژهٔ امشب" : "سورپرایز امشب"}</p>
            <h2 id="party-result-title" ref={titleRef} tabIndex={-1}>{outcome.headline}</h2>
            <h3>{outcome.title}</h3>
            <p id="party-result-reveal" className="party-result-reveal">{outcome.description}</p>
            <div className="party-plan">
              <h4><span aria-hidden="true">✦</span> نقشهٔ کوچولوی امشب</h4>
              <ol>{outcome.steps.map((step, index) => <li key={`${outcome.id}-${index}`}><span aria-hidden="true">{(index + 1).toLocaleString("fa-IR")}</span>{step}</li>)}</ol>
            </div>
          </div>
        </article>}
      </dialog>
    </main>
  );
}
