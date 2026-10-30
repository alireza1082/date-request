import type { CSSProperties, RefObject } from "react";
import type { Activity } from "../../../data/activities";
import { getSegmentAngles, normalizeDegrees } from "../engine/wheel-engine";

const VIEWBOX_SIZE = 500;
const CENTER = VIEWBOX_SIZE / 2;
const WHEEL_RADIUS = 222;
const LABEL_RADIUS = 151;

interface DateWheelProps {
  readonly activities: readonly Activity[];
  readonly rotation: number;
  readonly isSpinning: boolean;
  readonly isPreparing?: boolean;
  readonly hasResult: boolean;
  readonly wheelRef: RefObject<HTMLDivElement | null>;
  readonly spinButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onSpin: () => void;
}

function pointAt(radius: number, angle: number): { readonly x: number; readonly y: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(radians),
    y: CENTER + radius * Math.sin(radians),
  };
}

function segmentPath(start: number, end: number): string {
  const first = pointAt(WHEEL_RADIUS, start);
  const last = pointAt(WHEEL_RADIUS, end);
  return [
    `M ${CENTER} ${CENTER}`,
    `L ${first.x} ${first.y}`,
    `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${last.x} ${last.y}`,
    "Z",
  ].join(" ");
}

export function DateWheel({ activities, rotation, isSpinning, isPreparing = false, hasResult, wheelRef, spinButtonRef, onSpin }: DateWheelProps) {
  const settledRotation = normalizeDegrees(rotation);

  return (
    <div className="wheel-scene">
      <div className="wheel-halo" aria-hidden="true" />
      <div className={`wheel-frame${hasResult ? " is-landed" : ""}`}>
        <div className={`wheel-pointer${isSpinning ? " is-spinning" : ""}${hasResult ? " is-landed" : ""}`} aria-hidden="true">
          <span className="pointer-glint" />
        </div>
        <div className="wheel-inner-rim" aria-hidden="true" />
        <div
          ref={wheelRef}
          className="wheel-rotor"
          data-wheel-rotor
          data-segment-count={activities.length}
          data-rotation={rotation}
          style={{ "--wheel-rotation": `${rotation}deg` } as CSSProperties}
        >
          <svg className="wheel-svg" viewBox="0 0 500 500" aria-hidden="true">
            <circle className="wheel-face" cx={CENTER} cy={CENTER} r={WHEEL_RADIUS} />
            {activities.map((activity, index) => {
              const { start, end, center } = getSegmentAngles(index, activities.length);
              const label = pointAt(LABEL_RADIUS, center);

              return (
                <g key={activity.id}>
                  <path
                    d={segmentPath(start, end)}
                    fill={activity.color}
                    className="wheel-segment"
                    data-wheel-segment={activity.id}
                    data-wheel-title={activity.title}
                  />

                  <text
                    x={label.x}
                    y={label.y}
                    transform={`rotate(${-settledRotation} ${label.x} ${label.y})`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    unicodeBidi="plaintext"
                    lang="fa"
                    direction="rtl"
                    className={`wheel-label${activity.ink === "dark" ? " is-dark" : ""}`}
                  >
                    {activity.wheelLabel}
                  </text>
                </g>
              );
            })}
            <circle className="hub-ring" cx={CENTER} cy={CENTER} r="82" />
            <circle className="hub-shadow" cx={CENTER} cy={CENTER} r="68" />
            <circle className="hub-face" cx={CENTER} cy={CENTER} r="64" />
            <circle className="hub-emboss" cx={CENTER} cy={CENTER} r="57" />
          </svg>
        </div>

        <button
          ref={spinButtonRef}
          className="hub-button"
          type="button"
          onClick={onSpin}
          disabled={isSpinning || isPreparing}
          aria-label={isPreparing ? "در حال آماده‌کردن چرخ" : isSpinning ? "چرخ در حال چرخیدن است" : "چرخ را بچرخان"}
          aria-busy={isSpinning || isPreparing}
          aria-describedby="wheel-instructions"
        >
          <span className="hub-heart" aria-hidden="true">♥</span>
          <span>{isPreparing ? "یه لحظه…" : isSpinning ? "دارم می‌چرخم" : "بچرخون"}</span>
        </button>
        <div className="wheel-bolts" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <span key={index} style={{ "--bolt-angle": `${index * 30}deg` } as CSSProperties} />
          ))}
        </div>
      </div>
      <p className="wheel-assist" id="wheel-instructions">
        یک بار لمس کن، بقیه‌اش با سرنوشتِ قشنگِ ما
      </p>
      <ul className="visually-hidden" aria-label="قرارهای روی چرخ">
        {activities.map((activity) => (
          <li key={activity.id}>{activity.title}</li>
        ))}
      </ul>
    </div>
  );
}
