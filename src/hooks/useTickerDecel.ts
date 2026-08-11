import { useEffect, useRef } from "react";

/**
 * Drives an infinite ticker scroll.
 *
 * JavaScript only controls the short startup deceleration. The steady scroll is
 * handled by the browser animation engine, avoiding permanent per-frame React
 * page work while the market page is open.
 *
 * @param cruiseDuration Seconds for one full scroll cycle at cruise speed
 * @param direction 1 = scroll left, -1 = scroll right
 * @param initialRate Speed multiplier at start
 * @param decelMs Duration of the deceleration period in ms
 */
export function useTickerDecel(
  cruiseDuration: number,
  direction: 1 | -1 = 1,
  initialRate = 8,
  decelMs = 7000
) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || cruiseDuration <= 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = direction === 1 ? "translate3d(0%, 0, 0)" : "translate3d(-50%, 0, 0)";
      return;
    }

    const keyframes: Keyframe[] =
      direction === 1
        ? [{ transform: "translate3d(0%, 0, 0)" }, { transform: "translate3d(-50%, 0, 0)" }]
        : [{ transform: "translate3d(-50%, 0, 0)" }, { transform: "translate3d(0%, 0, 0)" }];

    const animation = el.animate(keyframes, {
      duration: cruiseDuration * 1000,
      easing: "linear",
      iterations: Infinity,
    });
    animation.playbackRate = initialRate;

    const startTime = performance.now();

    function frame(now: number) {
      const elapsed = now - startTime;
      if (elapsed >= decelMs) {
        animation.playbackRate = 1;
        return;
      }

      const t = elapsed / decelMs;
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      animation.playbackRate = initialRate + (1 - initialRate) * eased;
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      animation.cancel();
    };
  }, [cruiseDuration, direction, initialRate, decelMs]);

  return ref;
}
