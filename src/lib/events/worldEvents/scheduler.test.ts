import { describe, expect, it } from "vitest";
import { isRecurringDue, isScheduleDue, isWindowDue, windowGapTurns } from "./scheduler";

describe("isRecurringDue", () => {
  it("fires when (turn - offsetTurns) is an exact multiple of everyTurns", () => {
    expect(isRecurringDue(12, { everyTurns: 48, offsetTurns: 12 })).toBe(true);
    expect(isRecurringDue(60, { everyTurns: 48, offsetTurns: 12 })).toBe(true);
    expect(isRecurringDue(108, { everyTurns: 48, offsetTurns: 12 })).toBe(true);
  });

  it("does not fire on non-matching turns", () => {
    expect(isRecurringDue(11, { everyTurns: 48, offsetTurns: 12 })).toBe(false);
    expect(isRecurringDue(59, { everyTurns: 48, offsetTurns: 12 })).toBe(false);
  });

  it("does not fire before the offset turn is first reached", () => {
    // (0 - 12) % 48 === -12, not 0 — never fires before turn 12 under this schedule.
    expect(isRecurringDue(0, { everyTurns: 48, offsetTurns: 12 })).toBe(false);
  });

  it("returns false for a non-positive everyTurns (never divides)", () => {
    expect(isRecurringDue(12, { everyTurns: 0, offsetTurns: 12 })).toBe(false);
    expect(isRecurringDue(12, { everyTurns: -5, offsetTurns: 12 })).toBe(false);
  });

  it("supports offsetTurns of 0", () => {
    expect(isRecurringDue(0, { everyTurns: 10, offsetTurns: 0 })).toBe(true);
    expect(isRecurringDue(10, { everyTurns: 10, offsetTurns: 0 })).toBe(true);
    expect(isRecurringDue(5, { everyTurns: 10, offsetTurns: 0 })).toBe(false);
  });
});

describe("windowGapTurns", () => {
  const schedule = { minGapTurns: 20, maxGapTurns: 40 };

  it("is deterministic — same inputs always produce the same gap", () => {
    const gaps = Array.from({ length: 10 }, () =>
      windowGapTurns("UK", "worldEvents.royalEvent", 500, schedule)
    );
    expect(new Set(gaps).size).toBe(1);
  });

  it("always returns a value within [minGapTurns, maxGapTurns]", () => {
    for (let lastFired = 0; lastFired < 200; lastFired += 7) {
      const gap = windowGapTurns("UK", "worldEvents.royalEvent", lastFired, schedule);
      expect(gap).toBeGreaterThanOrEqual(schedule.minGapTurns);
      expect(gap).toBeLessThanOrEqual(schedule.maxGapTurns);
    }
  });

  it("produces a different (still deterministic) gap for a different lastFiredTurn", () => {
    const gapA = windowGapTurns("UK", "worldEvents.royalEvent", 100, schedule);
    const gapB = windowGapTurns("UK", "worldEvents.royalEvent", 101, schedule);
    // Not asserting inequality unconditionally (a hash collision across the
    // narrow band is possible) — assert each is independently deterministic
    // and at least one of several probes differs from gapA.
    const probes = Array.from({ length: 20 }, (_, i) =>
      windowGapTurns("UK", "worldEvents.royalEvent", 100 + i, schedule)
    );
    expect(probes.some((g) => g !== gapA)).toBe(true);
    expect(gapB).toBeGreaterThanOrEqual(schedule.minGapTurns);
  });

  it("varies by countryId and definitionKind for the same lastFiredTurn", () => {
    const gapUS = windowGapTurns("US", "worldEvents.royalEvent", 100, schedule);
    const gapUK = windowGapTurns("UK", "worldEvents.royalEvent", 100, schedule);
    const gapOtherKind = windowGapTurns("UK", "worldEvents.papalVisit", 100, schedule);
    // At least one differs — proves countryId/kind are part of the seed, not
    // just lastFiredTurn (would otherwise always collide across all three).
    expect(new Set([gapUS, gapUK, gapOtherKind]).size).toBeGreaterThan(1);
  });

  it("throws when minGapTurns exceeds maxGapTurns", () => {
    expect(() =>
      windowGapTurns("UK", "worldEvents.royalEvent", 100, { minGapTurns: 40, maxGapTurns: 20 })
    ).toThrow();
  });
});

describe("isWindowDue", () => {
  const schedule = { minGapTurns: 20, maxGapTurns: 40 };

  it("is immediately due when the definition has never fired for this country", () => {
    expect(isWindowDue(1, "UK", "worldEvents.royalEvent", undefined, schedule)).toBe(true);
  });

  it("is not due before lastFiredTurn + the deterministic gap", () => {
    const gap = windowGapTurns("UK", "worldEvents.royalEvent", 100, schedule);
    expect(isWindowDue(100 + gap - 1, "UK", "worldEvents.royalEvent", 100, schedule)).toBe(false);
    expect(isWindowDue(100 + gap, "UK", "worldEvents.royalEvent", 100, schedule)).toBe(true);
    expect(isWindowDue(100 + gap + 5, "UK", "worldEvents.royalEvent", 100, schedule)).toBe(true);
  });
});

describe("isScheduleDue — dispatches on schedule.kind", () => {
  it("delegates to isRecurringDue for a recurring schedule", () => {
    expect(
      isScheduleDue(12, "US", "worldEvents.olympics", undefined, {
        kind: "recurring",
        everyTurns: 48,
        offsetTurns: 12,
      })
    ).toBe(true);
  });

  it("delegates to isWindowDue for a window schedule", () => {
    expect(
      isScheduleDue(1, "UK", "worldEvents.royalEvent", undefined, {
        kind: "window",
        minGapTurns: 24,
        maxGapTurns: 48,
      })
    ).toBe(true);
  });
});
