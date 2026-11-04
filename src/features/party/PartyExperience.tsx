import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getSegmentAngles } from "../wheel/engine/wheel-engine";
import { useWheelSpin } from "../wheel/hooks/useWheelSpin";
import { partyOutcomes } from "./party-catalog";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wheel = useWheelSpin();
  const [imageFailed, setImageFailed] = useState(false);
  const outcome = wheel.selectedIndex === null ? null : partyOutcomes[wheel.selectedIndex] ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!outcome || !dialog || dialog.open) return;
    setImageFailed(false);
    dialog.showModal();
    const frame = requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [outcome]);

  const closeResult = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
  };

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
        <h1 id="party-title">امشب قراره<br /><span>یه شب متفاوت باشه</span></h1>
        <p className="party-lede">شش تا سورپرایز داریم، ولی فقط یکی قراره برای تو انتخاب بشه!</p>

        <div className="party-wheel-stage">
          <span className="party-pointer" aria-hidden="true"><i /></span>
          <div className="party-wheel-frame">
            <div
              ref={rotorRef}
              className="party-wheel-rotor"
              data-party-wheel-rotor
              data-segment-count="6"
              data-result-index={wheel.selectedIndex ?? ""}
              style={{ "--party-rotation": `${wheel.rotation}deg` } as CSSProperties}
            >
              <svg className="party-wheel-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-labelledby="party-wheel-title party-wheel-description">
                <title id="party-wheel-title">چرخ رمزآلود شب دونفره</title>
                <desc id="party-wheel-description">شش بخش هم‌اندازه با علامت سؤال؛ نتیجه پس از چرخش آشکار می‌شود.</desc>
                <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="#291d43" />
                {partyOutcomes.map((item, index) => {
                  const { start, end, center } = getSegmentAngles(index, partyOutcomes.length);
                  const point = pointAt(LABEL_RADIUS, center);
                  return <g key={item.id}>
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
          onClick={() => wheel.spin(rotorRef.current, partyOutcomes.length)}
        >
          {wheel.isSpinning ? "سورپرایز داره آماده می‌شه…" : "بچرخون ببین چی در انتظارته! 🎡"}
        </button>
        <p className="party-wheel-note" aria-live="polite">{wheel.isSpinning ? "چرخ در حال انتخاب سورپرایزته" : "اسم‌ها تا پایان چرخش یک راز می‌مونن."}</p>
        {wheel.error && <p className="party-wheel-error" role="alert">{wheel.error} دوباره امتحان کن.</p>}
      </section>

      <footer className="party-footer">شش مسیر برای یک شبِ به‌یادماندنی <span aria-hidden="true">✦</span></footer>

      <dialog
        ref={dialogRef}
        className="party-result-dialog"
        aria-modal="true"
        aria-labelledby="party-result-title"
        aria-describedby="party-result-reveal"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }}
        onClose={() => {
          wheel.clearResult();
          requestAnimationFrame(() => spinButtonRef.current?.focus({ preventScroll: true }));
        }}
      >
        {outcome && <article className="party-result-card" dir="rtl">
          <button className="party-result-close" type="button" onClick={closeResult} aria-label="بستن نتیجه و بازگشت به چرخ">×</button>
          <div className="party-artwork-wrap">
            {!imageFailed ? <img className="party-result-artwork" src={outcome.image} alt={outcome.alt} width="480" height="300" onError={() => setImageFailed(true)} /> : <div className="party-artwork-fallback" role="img" aria-label={outcome.alt}><span aria-hidden="true">✦</span></div>}
            <span className="party-artwork-sheen" aria-hidden="true" />
          </div>
          <div className="party-result-copy">
            <p className="party-result-kicker"><span aria-hidden="true">✧</span> سورپرایز امشب</p>
            <h2 id="party-result-title" ref={titleRef} tabIndex={-1}>{outcome.headline}</h2>
            <h3>{outcome.title}</h3>
            <p id="party-result-reveal" className="party-result-reveal">{outcome.reveal}</p>
            <div className="party-plan">
              <h4><span aria-hidden="true">✦</span> نقشهٔ کوچولوی امشب</h4>
              <ol>{outcome.steps.map((step, index) => <li key={`${outcome.id}-${index}`}><span aria-hidden="true">{(index + 1).toLocaleString("fa-IR")}</span>{step}</li>)}</ol>
            </div>
            <button className="party-result-return" type="button" onClick={closeResult}>برگردیم به چرخ <span aria-hidden="true">↻</span></button>
          </div>
        </article>}
      </dialog>
    </main>
  );
}
