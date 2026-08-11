// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGameClock } from "./useGameClock";
import * as eventsMod from "@/hooks/useGameEvents";

vi.mock("@/hooks/useGameEvents", () => ({
  useGameTurnStatus: vi.fn(),
}));

describe("useGameClock", () => {
  const fixedNow = new Date("2026-05-20T13:11:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  it("returns a no-op clock when status is null", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue(null);
    const { result } = renderHook(() => useGameClock());
    expect(result.current.now).toEqual(fixedNow);
    expect(result.current.isActive).toBe(false);
    expect(result.current.formatRemaining(new Date()).text).toBe("No timer");
  });

  it("returns a clock with now = lastTurnProcessed", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 943,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: "2026-05-19T23:00:00.000Z",
      pausedAt: null,
      pauseReason: null,
      pauseKind: null,
    });
    const { result } = renderHook(() => useGameClock());
    expect(result.current.now.toISOString()).toBe("2026-05-19T23:00:00.000Z");
    expect(result.current.driftMs).toBeGreaterThan(0); // game clock behind real time (display only)
    expect(result.current.isPaused).toBe(false);
  });

  it("now = pausedAt when paused", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 943,
      isActive: false,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: "2026-05-19T23:00:00.000Z",
      pausedAt: "2026-05-20T10:00:00.000Z",
      pauseReason: "manual",
      pauseKind: "manual",
    });
    const { result } = renderHook(() => useGameClock());
    expect(result.current.isPaused).toBe(true);
    expect(result.current.pauseKind).toBe("manual");
    expect(result.current.now.toISOString()).toBe("2026-05-20T10:00:00.000Z");
  });

  it("formatRemaining uses game-clock not real-clock", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 943,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: "2026-05-19T23:00:00.000Z",
      pausedAt: null,
    });
    const { result } = renderHook(() => useGameClock());
    const r = result.current.formatRemaining("2026-05-21T00:00:00.000Z");
    expect(r.text).toBe("1d 1h"); // 25h from gameClock
  });
});

describe("useGameClock — formatYear honors per-game startingYear", () => {
  const fixedNow = new Date("2026-05-20T00:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  function mockStatus(extra: Record<string, unknown>) {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 1,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: fixedNow.toISOString(),
      pausedAt: null,
      pauseReason: null,
      pauseKind: null,
      ...extra,
    });
  }

  // 60 turns (= 60h) past turn 1 lands in game-year 2 (floor(60/48) = 1).
  const sixtyTurnsAhead = new Date(fixedNow.getTime() + 60 * 3_600_000);

  it("uses startingYear from status for a 1991-preset reset (1992, not 2020)", () => {
    mockStatus({ startingYear: 1991 });
    const { result } = renderHook(() => useGameClock());
    expect(result.current.formatYear(sixtyTurnsAhead)).toBe(1992);
  });

  it("uses startingYear from status for a 2019-preset reset", () => {
    mockStatus({ startingYear: 2019 });
    const { result } = renderHook(() => useGameClock());
    expect(result.current.formatYear(sixtyTurnsAhead)).toBe(2020);
  });

  it("falls back to the default starting year when status omits it", () => {
    mockStatus({});
    const { result } = renderHook(() => useGameClock());
    expect(result.current.formatYear(sixtyTurnsAhead)).toBe(2020);
  });
});

describe("useGameClock — formatAbsoluteDeadline / toAbsoluteWallClock", () => {
  const fixedNow = new Date("2026-05-26T16:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  it("zero drift: toAbsoluteWallClock returns the deadline unchanged", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 100,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: fixedNow.toISOString(),
      pausedAt: null,
      pauseReason: null,
      pauseKind: null,
    });
    const { result } = renderHook(() => useGameClock());
    const deadline = new Date("2026-05-30T00:42:00Z");
    expect(result.current.toAbsoluteWallClock(deadline)?.toISOString()).toBe(
      deadline.toISOString()
    );
  });

  it("3h drift: shifts the deadline forward 3 hours", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 100,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: new Date(fixedNow.getTime() - 3 * 3_600_000).toISOString(),
      pausedAt: null,
      pauseReason: null,
      pauseKind: null,
    });
    const { result } = renderHook(() => useGameClock());
    const deadline = new Date("2026-05-30T00:42:00Z");
    const shifted = result.current.toAbsoluteWallClock(deadline);
    expect(shifted?.getTime()).toBe(deadline.getTime() + 3 * 3_600_000);
  });

  it("returns null / '—' for nullish or invalid input", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 100,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: fixedNow.toISOString(),
      pausedAt: null,
      pauseReason: null,
      pauseKind: null,
    });
    const { result } = renderHook(() => useGameClock());
    expect(result.current.toAbsoluteWallClock(null)).toBeNull();
    expect(result.current.toAbsoluteWallClock("not-a-date")).toBeNull();
    expect(result.current.formatAbsoluteDeadline(null)).toBe("—");
  });

  it("null-status branch: formatAbsoluteDeadline still formats given a real date (no drift)", () => {
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue(null);
    const { result } = renderHook(() => useGameClock());
    const deadline = new Date("2026-05-30T00:42:00Z");
    expect(result.current.toAbsoluteWallClock(deadline)?.toISOString()).toBe(
      deadline.toISOString()
    );
    expect(result.current.formatAbsoluteDeadline(null)).toBe("—");
  });

  it("formatRemainingTurns / projectTurnToDate mirror the server facade", () => {
    vi.setSystemTime(new Date("2026-05-29T22:00:00Z"));
    vi.mocked(eventsMod.useGameTurnStatus).mockReturnValue({
      currentTurn: 100,
      isActive: true,
      isProcessing: false,
      nextScheduledTurn: null,
      lastTurnProcessed: "2026-05-29T01:00:00.000Z",
      pausedAt: null,
    });
    const { result } = renderHook(() => useGameClock());
    expect(result.current.formatRemainingTurns(124).text).toBe("24 turns (~1d)");
    expect(result.current.formatRemainingTurns(100).urgency).toBe("ended");
    expect(result.current.projectTurnToDate(102)?.toISOString()).toBe("2026-05-30T00:00:00.000Z");
    expect(result.current.projectTurnToDate(null)).toBeNull();
  });
});
