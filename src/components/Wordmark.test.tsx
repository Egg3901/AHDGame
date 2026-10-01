/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, render } from "@testing-library/react";
import { WORDMARK, advanceWordmarkRun, wordmarkFrame, type WordmarkRun } from "./Wordmark";

/** Tick the run once per `step` ms from `from` to `to`, like animation frames. */
function runFrames(current: WordmarkRun | null, from: number, to: number, step = 16) {
  let r = current;
  for (let now = from; now <= to; now += step) r = advanceWordmarkRun(r, now);
  return r;
}

describe("wordmark run", () => {
  it("opens on an empty field with a blinking cursor", () => {
    expect(wordmarkFrame(null, 0)).toEqual({ keys: 0, cursor: "blinking" });
    const idle = runFrames(null, 0, 880);
    expect(wordmarkFrame(idle, 880)).toEqual({ keys: 0, cursor: "blinking" });
  });

  it("types a key at a time with the cursor held steady", () => {
    const first = runFrames(null, 0, 912);
    expect(wordmarkFrame(first, 912)).toEqual({ keys: 1, cursor: "typing" });
    // At one frame per 70 ms, every frame types a key.
    const later = runFrames(first, 912 + 70, 912 + 70 * 5, 70);
    expect(later?.keys).toBe(6);
    expect(wordmarkFrame(later, 912 + 70 * 5).cursor).toBe("typing");
  });

  it("stalls on a long frame instead of skipping keys", () => {
    const typing = runFrames(null, 0, 912);
    // A two-second long task: the next frame still types only one key.
    const afterStall = advanceWordmarkRun(typing, 2912);
    expect(afterStall.keys).toBe(2);
    // Two copies ticking in the same frame do not type twice.
    expect(advanceWordmarkRun(afterStall, 2912)).toBe(afterStall);
  });

  it("finishes the name, blinks a little longer, then drops the cursor", () => {
    const done = runFrames(null, 0, 3000);
    expect(done?.keys).toBe(WORDMARK.length);
    const typedAt = done?.typedAt ?? 0;
    expect(wordmarkFrame(done, typedAt)).toEqual({ keys: WORDMARK.length, cursor: "blinking" });
    expect(wordmarkFrame(done, typedAt + 2000)).toEqual({ keys: WORDMARK.length, cursor: "gone" });
  });
});

describe("Wordmark", () => {
  // The run is per page load, so each test loads a fresh module.
  async function load() {
    vi.resetModules();
    return (await import("./Wordmark")).Wordmark;
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prints the name as before when not typed", async () => {
    const Wordmark = await load();
    const { container } = render(<Wordmark className="x" />);
    expect(container.textContent).toBe(WORDMARK);
    expect(container.querySelector(".ahd-wordmark-cursor")).toBeNull();
  });

  it("starts typed on an empty field, keeps the full width and the full name for screen readers", async () => {
    const Wordmark = await load();
    const { container } = render(<Wordmark typed />);
    expect(container.querySelector(".sr-only")?.textContent).toBe(WORDMARK);
    expect(container.querySelector(".ahd-wordmark-cursor")).not.toBeNull();
    expect(container.querySelector(".invisible")?.textContent).toBe(WORDMARK);
  });

  it("types the name in and drops the cursor", async () => {
    const Wordmark = await load();
    const { container } = render(<Wordmark typed />);
    act(() => vi.advanceTimersByTime(1300));
    const typed = container.querySelector(".sr-only + span")?.textContent ?? "";
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.length).toBeLessThan(WORDMARK.length);
    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelector(".sr-only + span")?.textContent).toBe(WORDMARK);
    expect(container.querySelector(".ahd-wordmark-cursor")).toBeNull();
  });

  it("commits each key in the frame that types it", async () => {
    const Wordmark = await load();
    const { container } = render(<Wordmark typed />);
    const shown: number[] = [];
    // One act for the whole run: nothing here flushes renders between frames.
    act(() => {
      for (let t = 0; t < 2600; t += 16) {
        vi.advanceTimersByTime(16);
        const keys = container.querySelector(".sr-only + span")?.textContent?.length ?? 0;
        if (shown[shown.length - 1] !== keys) shown.push(keys);
      }
    });
    expect(shown).toEqual(Array.from({ length: WORDMARK.length + 1 }, (_, i) => i));
  });

  it("picks up a run already under way instead of starting from an empty field", async () => {
    const Wordmark = await load();
    const loading = render(<Wordmark typed />);
    act(() => vi.advanceTimersByTime(1300));
    const typedSoFar = loading.container.querySelector(".sr-only + span")?.textContent ?? "";
    expect(typedSoFar.length).toBeGreaterThan(0);
    loading.unmount();

    const real = render(<Wordmark typed />);
    expect(real.container.querySelector(".sr-only + span")?.textContent).toBe(typedSoFar);
  });
});
