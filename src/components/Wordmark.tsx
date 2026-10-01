"use client";

/**
 * The site name beside the logo. On a 1991 world it types itself in, a nod to
 * the dot-com era: a cursor blinks on an empty field for a moment, the name
 * arrives a key at a time, and the cursor blinks twice more and goes.
 *
 * There is one run per page load, shared by every mounted copy of the
 * wordmark. The loading navbar starts it, and the real navbar, mounting a beat
 * later, picks it up from the keys already typed instead of an empty field.
 * Client-side navigation keeps the navbar mounted, so it does not retype.
 * The run advances one key per animation frame at most, so a busy main thread
 * (the landing globe hydrating) stalls the typist rather than skipping keys.
 * Reduced motion shows the name at once, and screen readers always get the
 * whole name.
 */
import { useEffect, useState } from "react";

export const WORDMARK = "A House Divided";

/** The empty field shows a blinking cursor this long before the first key. */
const CURSOR_IDLE_MS = 900;
/** Shortest time between keys. */
const KEY_MS = 70;
/** The cursor stays after the last key for a couple of blinks. */
const CURSOR_LINGER_MS = 1500;

export type WordmarkRun = {
  startedAt: number;
  keys: number;
  lastKeyAt: number;
  /** When the last key landed, once it has. */
  typedAt: number | null;
};

export type WordmarkFrame = {
  keys: number;
  cursor: "blinking" | "typing" | "gone";
};

const START_FRAME: WordmarkFrame = { keys: 0, cursor: "blinking" };

/** This page load's run, and the frame it last showed. */
let run: WordmarkRun | null = null;
let lastFrame = START_FRAME;

/** The run one animation frame on, at `now`: one more key at most. */
export function advanceWordmarkRun(current: WordmarkRun | null, now: number): WordmarkRun {
  if (!current) return { startedAt: now, keys: 0, lastKeyAt: now, typedAt: null };
  if (
    current.keys >= WORDMARK.length ||
    now - current.startedAt < CURSOR_IDLE_MS ||
    now - current.lastKeyAt < KEY_MS
  ) {
    return current;
  }
  const keys = current.keys + 1;
  return { ...current, keys, lastKeyAt: now, typedAt: keys === WORDMARK.length ? now : null };
}

/** Characters shown and cursor state for a run at `now`. */
export function wordmarkFrame(current: WordmarkRun | null, now: number): WordmarkFrame {
  if (!current || current.typedAt === null) {
    // A terminal cursor holds steady while keys arrive and blinks when idle.
    return { keys: current?.keys ?? 0, cursor: current?.keys ? "typing" : "blinking" };
  }
  return {
    keys: WORDMARK.length,
    cursor: now - current.typedAt < CURSOR_LINGER_MS ? "blinking" : "gone",
  };
}

export function Wordmark({ typed = false, className }: { typed?: boolean; className?: string }) {
  // Before hydration finishes no run exists, so this matches the server's
  // empty field; a copy mounted later starts where the run is.
  const [frame, setFrame] = useState(() => lastFrame);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (!typed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(() => setReduced(true), 0);
      return () => window.clearTimeout(timer);
    }
    let handle = 0;
    const tick = (now: number) => {
      run = advanceWordmarkRun(run, now);
      const next = wordmarkFrame(run, now);
      lastFrame = next;
      setFrame((shown) =>
        shown.keys === next.keys && shown.cursor === next.cursor ? shown : next
      );
      if (next.cursor !== "gone") handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [typed]);

  if (!typed || reduced) return <span className={className}>{WORDMARK}</span>;

  const { keys, cursor } = frame;
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
