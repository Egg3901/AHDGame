"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Playback state for the Wrapped story: which slide is showing, whether the
 * auto-advance timer runs, and per-slide holds. A slide can `hold()` the timer
 * (the guess slide waits for an answer) and `release()` it again; the progress
 * bar reads `elapsed / duration` for the active segment.
 */
export interface StoryPlayer {
  index: number;
  paused: boolean;
  held: boolean;
  /** 0..1 progress through the active slide. */
  progress: number;
  goTo: (i: number) => void;
  next: () => void;
  prev: () => void;
  togglePause: () => void;
  hold: () => void;
  release: () => void;
}

export function useStoryPlayer(durations: number[], enabled: boolean): StoryPlayer {
  const total = durations.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const elapsedRef = useRef(0);

  const goTo = useCallback(
    (i: number) => {
      elapsedRef.current = 0;
      setProgress(0);
      setHeld(false);
      setIndex(Math.max(0, Math.min(total - 1, i)));
    },
    [total]
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  const duration = durations[index] ?? 0;
  const running = enabled && !paused && !held && duration > 0 && index < total - 1;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (last) elapsedRef.current += ts - last;
      last = ts;
      const p = Math.min(1, elapsedRef.current / duration);
      setProgress(p);
      if (p >= 1) {
        goTo(index + 1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, duration, index, goTo]);

  return {
    index,
    paused,
    held,
    progress: index >= total - 1 ? 1 : progress,
    goTo,
    next,
    prev,
    togglePause: useCallback(() => setPaused((p) => !p), []),
    hold: useCallback(() => setHeld(true), []),
    release: useCallback(() => setHeld(false), []),
  };
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Count 0 to target over `ms` once `active` turns true; instant without motion. */
export function useCountUp(target: number, active: boolean, motion: boolean, ms = 1100): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active || !motion) return;
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / ms);
      setVal(target * easeOutCubic(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, motion, ms]);
  if (!motion) return target;
  return active ? val : 0;
}
