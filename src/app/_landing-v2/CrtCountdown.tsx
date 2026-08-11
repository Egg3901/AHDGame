"use client";

/**
 * Green-phosphor CRT countdown that sits above the hero's "New in v1.0" badge.
 *
 * It is a fixed-deadline promo, not a recurring feature: once the deadline
 * passes the component renders nothing and `useCrtCountdown` reports inactive,
 * which also hands the globe's idle crisis showcase back to its normal
 * behaviour (see `showcasePaused` on LandingGlobe).
 *
 * Rendering is deliberately mount-gated. The server has no way to know the
 * viewer's clock, so a server-rendered timer either mismatches on hydration or
 * flashes a stale value; returning null until mounted avoids both.
 */
import { useEffect, useState } from "react";

/** 7pm Eastern on 2026-08-08. Written with the offset so it is unambiguous. */
export const CRT_COUNTDOWN_DEADLINE_MS = Date.parse("2026-08-08T19:00:00-04:00");

type Remaining = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** 0 (calm) to 4 (falling apart) — see GLITCH_STEPS. */
  glitch: number;
};

/**
 * The signal degrades as the deadline closes in. Bucketed rather than
 * continuous on purpose: the level feeds CSS custom properties, and a value
 * that changed every second would rewrite style on every tick for no visible
 * gain. Thresholds in ms remaining, strongest first.
 */
const GLITCH_STEPS: readonly [number, number][] = [
  [60_000, 4],
  [10 * 60_000, 3],
  [60 * 60_000, 2],
  [6 * 60 * 60_000, 1],
];

function glitchLevelFor(ms: number): number {
  for (const [threshold, level] of GLITCH_STEPS) {
    if (ms <= threshold) return level;
  }
  return 0;
}

function remainingFrom(now: number): Remaining | null {
  const ms = CRT_COUNTDOWN_DEADLINE_MS - now;
  if (ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor(total / 3600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
    glitch: glitchLevelFor(ms),
  };
}

/**
 * True only after mount AND while the deadline is still ahead. Drives both the
 * countdown itself and the showcase pause, so the two can never disagree.
 */
export function useCrtCountdown(): Remaining | null {
  const [remaining, setRemaining] = useState<Remaining | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(remainingFrom(Date.now()));
    tick();
    let timer = setInterval(tick, 1000);
    // A backgrounded tab should not be re-rendering a clock nobody can see.
    // Re-reading the deadline on the way back keeps it correct without a
    // catch-up loop, since every value is derived from Date.now().
    const onVisibility = () => {
      clearInterval(timer);
      if (document.visibilityState === "hidden") return;
      tick();
      timer = setInterval(tick, 1000);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return remaining;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function Cell({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className="ahd-crt-digits font-mono text-2xl font-bold leading-none tabular-nums sm:text-3xl">
        {pad(value)}
      </span>
      <span className="font-mono text-[0.55rem] uppercase tracking-[0.2em] opacity-70">
        {label}
      </span>
    </span>
  );
}

export function CrtCountdown({ remaining }: { remaining: Remaining | null }) {
  if (!remaining) return null;

  const readable = `${remaining.days}d ${remaining.hours}h ${remaining.minutes}m ${remaining.seconds}s remaining`;

  return (
    // Wrapper forces its own line: the "New in v1.0" badge below is inline-flex
    // and would otherwise sit beside the panel.
    <div className="mb-4">
      <div
        className="ahd-crt-panel inline-flex flex-col gap-2 rounded-lg px-4 py-3"
        data-glitch={remaining.glitch}
      >
        <span className="ahd-crt-flicker font-mono text-[0.6rem] uppercase tracking-[0.3em]">
          Countdown
        </span>
        <div className="flex items-end gap-3" aria-hidden="true">
          <Cell value={remaining.days} label="days" />
          <span className="ahd-crt-digits pb-3 font-mono text-xl leading-none opacity-60">:</span>
          <Cell value={remaining.hours} label="hrs" />
          <span className="ahd-crt-digits pb-3 font-mono text-xl leading-none opacity-60">:</span>
          <Cell value={remaining.minutes} label="min" />
          <span className="ahd-crt-digits pb-3 font-mono text-xl leading-none opacity-60">:</span>
          <Cell value={remaining.seconds} label="sec" />
        </div>
        {/* Screen readers get a single settled string, polite, so the per-second
            tick does not machine-gun the announcement queue. */}
        <span className="sr-only" role="timer" aria-live="polite">
          {readable}
        </span>
      </div>
    </div>
  );
}
