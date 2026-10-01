"use client";

/**
 * The site name beside the logo. On a 1991 world it types itself in, a nod to
 * the dot-com era: a cursor blinks on an empty field for a moment, the name
 * arrives a key at a time, and the cursor blinks twice more and goes.
 *
 * There is one run per page load, timed from a clock every copy of the
 * wordmark shares. The loading navbar starts it and the real navbar, mounting a
 * beat later, picks the run up where it was instead of starting again.
 * Client-side navigation keeps the navbar mounted, so it does not retype.
 * Reduced motion shows the name at once, and screen readers always get the
 * whole name.
 */
import { useEffect, useState } from "react";

export const WORDMARK = "A House Divided";

/** The empty field shows a blinking cursor this long before the first key. */
const CURSOR_IDLE_MS = 900;
/** Time per key. */
const KEY_MS = 70;
/** The cursor stays after the last key for a couple of blinks. */
const CURSOR_LINGER_MS = 1500;
const TYPING_DONE_MS = CURSOR_IDLE_MS + WORDMARK.length * KEY_MS;
const RUN_MS = TYPING_DONE_MS + CURSOR_LINGER_MS;

/** When this page load's run began; shared by every mounted wordmark. */
let runStartedAt: number | null = null;

/** Characters shown and cursor state at `elapsed` ms into the run. */
export function typedWordmarkFrame(elapsed: number): {
  keys: number;
  cursor: "blinking" | "typing" | "gone";
} {
  const keys = Math.max(
    0,
    Math.min(WORDMARK.length, Math.floor((elapsed - CURSOR_IDLE_MS) / KEY_MS) + 1)
  );
  if (elapsed >= RUN_MS) return { keys: WORDMARK.length, cursor: "gone" };
  // A terminal cursor holds steady while keys arrive and blinks when idle.
  return {
    keys,
    cursor: elapsed >= CURSOR_IDLE_MS && elapsed < TYPING_DONE_MS ? "typing" : "blinking",
  };
}

export function Wordmark({ typed = false, className }: { typed?: boolean; className?: string }) {
  const [elapsed, setElapsed] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (!typed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(() => setReduced(true), 0);
      return () => window.clearTimeout(timer);
    }
    runStartedAt ??= performance.now();
    const startedAt = runStartedAt;
    let frame = 0;
    const tick = () => {
      const ms = performance.now() - startedAt;
      setElapsed(ms);
      if (ms < RUN_MS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [typed]);

  if (!typed || reduced) return <span className={className}>{WORDMARK}</span>;

  const { keys, cursor } = typedWordmarkFrame(elapsed);
  return (
    <span className={className}>
      <span className="sr-only">{WORDMARK}</span>
      <span aria-hidden="true">{WORDMARK.slice(0, keys)}</span>
      {cursor !== "gone" && (
        <span
          aria-hidden="true"
          className={`ahd-wordmark-cursor ${cursor === "typing" ? "ahd-wordmark-cursor-steady" : ""}`}
        />
      )}
      {/* The untyped rest holds the name's full width, so nothing beside it moves. */}
      <span aria-hidden="true" className="invisible">
        {WORDMARK.slice(keys)}
      </span>
    </span>
  );
}
