import type { SeasonalSettings } from "../../data/seasonal-settings";
import "./halloween.css";

export function HalloweenInvitationCard({
  settings,
  onContinue,
  preview = false,
}: {
  readonly settings: SeasonalSettings;
  readonly onContinue: () => void;
  readonly preview?: boolean;
}) {
  return (
    <section className={`halloween-invitation${preview ? " is-preview" : ""}`} aria-labelledby={preview ? undefined : "halloween-title"}>
      <div className="halloween-night-art" aria-hidden="true">
        <svg viewBox="0 0 520 280" role="presentation">
          <path d="M28 213c55-44 98-28 145-44 57-19 94-58 152-43 58 15 91 63 167 54v100H28Z" fill="#30283e" />
          <path d="M28 235c72-38 119-12 174-32 60-22 94-55 146-45 48 10 76 41 144 42v80H28Z" fill="#463040" />
          <circle cx="392" cy="76" r="42" fill="#f4d69d" opacity=".96" />
          <circle cx="407" cy="61" r="40" fill="#25253b" />
          <path d="m69 50 4 10 10 4-10 4-4 10-4-10-10-4 10-4Zm78 28 3 7 7 3-7 3-3 7-3-7-7-3 7-3Zm251 24 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#f6d99b" />
          <path d="M51 230c18-26 31-29 50-18m276 8c19-31 39-30 60-16m-304 51c14-14 26-17 39-13" fill="none" stroke="#d99c66" strokeWidth="3" strokeLinecap="round" />
          <g transform="translate(97 163)">
            <path d="M59 16c-4-21 4-39 18-39 11 0 17 15 15 31" fill="none" stroke="#94a579" strokeWidth="7" strokeLinecap="round" />
            <ellipse cx="36" cy="63" rx="30" ry="35" fill="#d87d48" stroke="#f2b268" strokeWidth="4" />
            <ellipse cx="64" cy="62" rx="31" ry="38" fill="#e78c4c" stroke="#f7bd72" strokeWidth="4" />
            <ellipse cx="92" cy="63" rx="28" ry="34" fill="#d87d48" stroke="#f2b268" strokeWidth="4" />
            <path d="m43 54 8 6-8 5m39-11-8 6 8 5m-27 14h23" fill="none" stroke="#5b3540" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M72 21c-3-13 1-23 7-29" fill="none" stroke="#a9b187" strokeWidth="4" strokeLinecap="round" />
          </g>
          <g transform="translate(353 191)">
            <path d="M33 14V2m38 12V2" stroke="#89a07c" strokeWidth="5" strokeLinecap="round" />
            <path d="M26 20c-5-8 2-16 8-11 4-8 13-4 14 3 8-4 14 5 9 11 8 6 3 16-4 17 2 10-10 14-15 8-7 7-17 1-14-7-9 0-12-11-5-16Z" fill="#e38d4b" stroke="#f3b569" strokeWidth="3" />
            <path d="m36 27 5 4-5 4m15-8-5 4 5 4m-11 7h7" fill="none" stroke="#623943" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M85 54c-4-9 1-18 8-18 6 0 9 7 7 14" fill="none" stroke="#e6bb78" strokeWidth="4" strokeLinecap="round" />
            <path d="M88 48v29m0-19-10-5m10 10 10-5" fill="none" stroke="#f7d89e" strokeWidth="3" strokeLinecap="round" />
          </g>
          <path d="m240 42 3 8 8 3-8 3-3 8-3-8-8-3 8-3Zm45 49 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#f6d99b" />
        </svg>
      </div>
      <p className="halloween-eyebrow"><span aria-hidden="true">☾</span> یک دعوتِ پاییزی</p>
      <h1 id={preview ? undefined : "halloween-title"}>{settings.halloween_title}</h1>
      <p className="halloween-subtitle">{settings.halloween_subtitle}</p>
      {settings.halloween_note && <p className="halloween-note">{settings.halloween_note}</p>}
      {preview
        ? <span className="halloween-cta halloween-cta-preview">{settings.halloween_cta}</span>
        : <button className="halloween-cta" type="button" autoFocus onClick={onContinue}>{settings.halloween_cta}<span aria-hidden="true">←</span></button>}
      {!preview && <span className="halloween-signoff">بعدش با هم چرخ رو می‌چرخونیم <span aria-hidden="true">✦</span></span>}
    </section>
  );
}

export function HalloweenScreen({ settings, onContinue }: { readonly settings: SeasonalSettings; readonly onContinue: () => void }) {
  return (
    <main className="halloween-screen" dir="rtl">
      <div className="halloween-orbit halloween-orbit-one" aria-hidden="true" />
      <div className="halloween-orbit halloween-orbit-two" aria-hidden="true" />
      <HalloweenInvitationCard settings={settings} onContinue={onContinue} />
    </main>
  );
}
