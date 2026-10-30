import { moods, type MoodId, type MoodOption } from "../../data/moods";

interface MoodSelectorProps {
  readonly value: MoodId;
  readonly onChange: (mood: MoodId) => void;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly options?: readonly MoodOption[];
}

export function MoodSelector({ value, onChange, disabled = false, compact = false, options = moods }: MoodSelectorProps) {
  return (
    <div className={`mood-selector${compact ? " is-compact" : ""}`} role="radiogroup" aria-label="حال‌وهوای قرار">
      {options.map((mood, index) => (
        <button
          className={`mood-option${value === mood.id ? " is-selected" : ""}`}
          key={mood.id}
          type="button"
          role="radio"
          aria-checked={value === mood.id}
          aria-label={`${mood.label}، ${mood.note}`}
          disabled={disabled}
          onClick={() => onChange(mood.id)}
          onKeyDown={(event) => {
            if (!event.currentTarget.parentElement || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
            const next = options[(index + direction + options.length) % options.length];
            if (!next) return;
            onChange(next.id);
            event.currentTarget.parentElement.querySelectorAll<HTMLButtonElement>("[role=radio]")[
              (index + direction + options.length) % options.length
            ]?.focus();
          }}
        >
          <span className="mood-label">{mood.label}</span>
          {!compact && <span className="mood-note">{mood.note}</span>}
          <span className="mood-check" aria-hidden="true">{value === mood.id ? "✦" : ""}</span>
        </button>
      ))}
    </div>
  );
}
