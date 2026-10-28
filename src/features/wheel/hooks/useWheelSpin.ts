import { useCallback, useEffect, useRef, useState } from "react";
import { calculateSpinTarget, selectRandomIndex } from "../engine/wheel-engine";

const STANDARD_SPIN_DURATION = 5_200;
const FULL_SPINS = 5;
const SPIN_EASING = "cubic-bezier(0.12, 0.02, 0.18, 1)";

export interface WheelSpinState {
  readonly rotation: number;
  readonly selectedIndex: number | null;
  readonly isSpinning: boolean;
  readonly error: string | null;
  readonly spin: (wheelElement: HTMLDivElement | null, count: number) => void;
  readonly clearResult: () => void;
}

export function useWheelSpin(): WheelSpinState {
  const [rotation, setRotation] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rotationRef = useRef(0);
  const isSpinningRef = useRef(false);
  const animationRef = useRef<Animation | null>(null);

  useEffect(() => () => {
    isSpinningRef.current = false;
    animationRef.current?.cancel();
  }, []);

  const spin = useCallback((wheelElement: HTMLDivElement | null, count: number) => {
    if (!wheelElement || isSpinningRef.current) return;

    isSpinningRef.current = true;
    setIsSpinning(true);
    setSelectedIndex(null);
    setError(null);

    try {
      const index = selectRandomIndex(count);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const target = calculateSpinTarget(rotationRef.current, index, count, FULL_SPINS);

      if (reducedMotion) {
        wheelElement.style.transform = `rotate(${target}deg)`;
        rotationRef.current = target;
        setRotation(target);
        setSelectedIndex(index);
        isSpinningRef.current = false;
        setIsSpinning(false);
        return;
      }

      const animation = wheelElement.animate(
        [
          { transform: `rotate(${rotationRef.current}deg)` },
          { transform: `rotate(${target}deg)` },
        ],
        {
          duration: STANDARD_SPIN_DURATION,
          easing: SPIN_EASING,
          fill: "forwards",
        },
      );

      animationRef.current = animation;
      animation.onfinish = () => {
        if (!isSpinningRef.current) return;
        wheelElement.style.transform = `rotate(${target}deg)`;
        animation.cancel();
        animationRef.current = null;
        rotationRef.current = target;
        setRotation(target);
        setSelectedIndex(index);
        isSpinningRef.current = false;
        setIsSpinning(false);
      };
    } catch {
      isSpinningRef.current = false;
      setIsSpinning(false);
      setError("چرخ این‌بار آماده نشد؛ لطفاً دوباره امتحان کن.");
    }
  }, []);

  const clearResult = useCallback(() => setSelectedIndex(null), []);

  return { rotation, selectedIndex, isSpinning, error, spin, clearResult };
}
