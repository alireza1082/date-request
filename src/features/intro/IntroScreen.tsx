import { useState } from "react";

export function IntroScreen({ onContinue }: { readonly onContinue: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const enter = () => {
    if (leaving) return;
    setLeaving(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onContinue();
    else window.setTimeout(onContinue, 240);
  };
  return (
    <main className={`welcome-screen${leaving ? " is-leaving" : ""}`}>
      <div className="welcome-paper">
        <span className="welcome-edition">چرخِ قرار <span aria-hidden="true">·</span> یک دعوتِ کوچولو</span>
        <svg className="welcome-art" viewBox="0 0 300 240" aria-hidden="true">
          <circle cx="150" cy="118" r="102" fill="none" stroke="#d9bda3" strokeDasharray="2 8" />
          <path d="M48 88h204v126H48z" fill="#ecd7c0" stroke="#bb947c" strokeWidth="2" />
          <path d="m48 88 102-65 102 65-102 77Z" fill="#f0dfce" stroke="#bb947c" strokeWidth="2" />
          <path d="M77 53h146v135H77z" fill="#fffaf2" stroke="#d9bda3" strokeWidth="2" transform="rotate(-5 150 120)" />
          <path d="M118 87h64m-75 17h86m-65 17h44" stroke="#c49a89" strokeWidth="2" strokeLinecap="round" />
          <path d="m48 214 102-80 102 80M48 88l102 77L252 88v126H48Z" fill="#f2e1cd" stroke="#bb947c" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="150" cy="165" r="23" fill="#995d68" /><path d="M150 152v26m-13-13h26m-22-9 18 18m0-18-18 18" stroke="#f8e8d5" strokeWidth="1.5" />
        </svg>
        <p className="welcome-eyebrow">برای یک خاطرهٔ تازه</p>
        <h1>یه سورپرایز کوچولو<br /><em>برات دارم…</em></h1>
        <p className="welcome-description">گاهی یه تصمیم کوچیک، یه روز قشنگ می‌سازه.<br />بیا ببینیم امروز چرخ کجا می‌برتمون.</p>
        <button className="button button-primary welcome-cta" type="button" onClick={enter} disabled={leaving}>بزن بریم! <span aria-hidden="true">←</span></button>
        <span className="welcome-footnote">چند ایدهٔ دوست‌داشتنی، یک قرارِ دونفره</span>
      </div>
    </main>
  );
}
