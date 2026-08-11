import { describe, expect, it } from "vitest";
import { computeGameNow } from "./computeGameNow";
import { MS_PER_TURN } from "@/lib/constants/turnTime";

describe("computeGameNow", () => {
  const now = new Date("2026-05-30T16:00:00Z").getTime();

  it("on-time: tracks real time (game clock == wall clock)", () => {
    // last turn one hour ago → on-time hourly cadence; clock should equal now.
    const lastProcessed = new Date(now - MS_PER_TURN);
    expect(computeGameNow(lastProcessed, now).getTime()).toBe(now);
  });

  it("behind: snaps up to real time (catch-up, no extra turn)", () => {
    // clock is 26h behind: real time has run far ahead → snap up to now.
    const lastProcessed = new Date(now - 26 * MS_PER_TURN);
    expect(computeGameNow(lastProcessed, now).getTime()).toBe(now);
  });

  it("null lastTurnProcessed (fresh game): stamps real time", () => {
    expect(computeGameNow(null, now).getTime()).toBe(now);
  });

  it("accepts a date-like value (ISO string)", () => {
    const lastProcessed = new Date(now - 26 * MS_PER_TURN).toISOString();
    expect(computeGameNow(lastProcessed, now).getTime()).toBe(now);
  });

  // ── Normal-mode convergence (the drift fix) ──────────────────────────────
  // When the game clock is AHEAD of real time (scar left by a prior fast-mode
  // session or sub-hour cron burst), normal mode must NOT ratchet a further
  // full hour ahead. It advances minimally forward so wall-clock catches up and
  // the offset self-heals, instead of being carried forward forever.

  it("normal-mode ahead: does NOT pull a full game-hour ahead (converges)", () => {
    // Clock is 90 min ahead of real (the observed live scar).
    const lastProcessed = new Date(now + 90 * 60_000);
    const result = computeGameNow(lastProcessed, now).getTime();
    // Strictly forward (monotonic), but only minimally — not +1h ahead.
    expect(result).toBeGreaterThan(lastProcessed.getTime());
    expect(result).toBeLessThan(lastProcessed.getTime() + MS_PER_TURN);
  });

  it("normal-mode ahead: self-heals to real time within two hourly turns", () => {
    const real0 = now;
    let lastProcessed: Date = new Date(real0 + 90 * 60_000); // +1h30m scar

    // Turn A — real advances one hour; clock still ahead, advances minimally.
    const realA = real0 + MS_PER_TURN;
    lastProcessed = computeGameNow(lastProcessed, realA);
    expect(lastProcessed.getTime()).toBeGreaterThan(realA); // still ahead, not yet healed

    // Turn B — real overtakes the scarred clock → snaps to real (healed).
    const realB = real0 + 2 * MS_PER_TURN;
    lastProcessed = computeGameNow(lastProcessed, realB);
    expect(lastProcessed.getTime()).toBe(realB);
  });

  it("normal-mode is monotonic: result is always strictly > lastProcessed", () => {
    const lastProcessed = new Date(now + 90 * 60_000);
    expect(computeGameNow(lastProcessed, now).getTime()).toBeGreaterThan(lastProcessed.getTime());
  });

  // ── Fast-mode: intentional pull-ahead is preserved ───────────────────────
  // Fast-mode runs turns every 30 min but advances the calendar one game-hour
  // per turn, so the clock SHOULD pull ahead of real time. That behavior is
  // unchanged; only normal mode converges.

  it("fast-mode / ahead: advances exactly one game-hour, pulling ahead of real time", () => {
    // turns fire every 30 min: lastProcessed was 30 min ago, +1h exceeds now
    const lastProcessed = new Date(now - MS_PER_TURN / 2);
    expect(computeGameNow(lastProcessed, now, { fastMode: true }).getTime()).toBe(
      lastProcessed.getTime() + MS_PER_TURN
    );
  });

  it("fast-mode is monotonic: result is always >= lastProcessed + MS_PER_TURN", () => {
    const lastProcessed = new Date(now - 26 * MS_PER_TURN);
    expect(computeGameNow(lastProcessed, now, { fastMode: true }).getTime()).toBeGreaterThanOrEqual(
      lastProcessed.getTime() + MS_PER_TURN
    );
  });
});
