import { describe, expect, it, vi, beforeEach } from "vitest";
import { getGameClock } from "./gameClock.server";
import * as gameTimeMod from "./gameTime";
import * as mongoMod from "@/lib/mongodb";

vi.mock("./gameTime", () => ({
  getGameTime: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

function mockDbWithPauseFields(pauseReason: string | null, pauseKind: string | null) {
  vi.mocked(mongoMod.getDb).mockResolvedValue({
    collection: () => ({
      findOne: async () => ({ pauseReason, pauseKind }),
    }),
  } as unknown as Awaited<ReturnType<typeof mongoMod.getDb>>);
}

describe("getGameClock", () => {
  const fixedNow = new Date("2026-05-20T13:11:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    mockDbWithPauseFields(null, null);
  });

  it("returns now = lastTurnProcessed when not paused", async () => {
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 943,
      lastTurnProcessed: new Date("2026-05-19T23:00:00Z"),
      isActive: true,
      pausedAt: null,
      effectiveNow: new Date("2026-05-19T23:00:00Z"),
      startingYear: 2019,
    });
    const clock = await getGameClock();
    expect(clock.now.toISOString()).toBe("2026-05-19T23:00:00.000Z");
    expect(clock.realNow.toISOString()).toBe(fixedNow.toISOString());
    expect(clock.isPaused).toBe(false);
    expect(clock.isActive).toBe(true);
    expect(clock.driftMs).toBe(14 * 3_600_000 + 11 * 60_000);
  });

  it("returns now = pausedAt when paused", async () => {
    const pausedAt = new Date("2026-05-20T10:00:00Z");
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 943,
      lastTurnProcessed: new Date("2026-05-19T23:00:00Z"),
      isActive: false,
      pausedAt,
      effectiveNow: pausedAt,
      startingYear: 2019,
    });
    mockDbWithPauseFields("manual stop", "manual");
    const clock = await getGameClock();
    expect(clock.now.toISOString()).toBe(pausedAt.toISOString());
    expect(clock.isPaused).toBe(true);
    expect(clock.pauseKind).toBe("manual");
    expect(clock.pauseReason).toBe("manual stop");
  });

  it("formatRemaining returns ended for past deadlines", async () => {
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed: new Date("2026-05-19T23:00:00Z"),
      isActive: true,
      pausedAt: null,
      effectiveNow: new Date("2026-05-19T23:00:00Z"),
      startingYear: 2019,
    });
    const clock = await getGameClock();
    const past = new Date("2026-05-18T00:00:00Z");
    expect(clock.formatRemaining(past).urgency).toBe("ended");
  });

  it("formatRemaining uses game-clock now (not real now)", async () => {
    // gameClock at 2026-05-19T23:00. Real now is 2026-05-20T13:11.
    // Deadline at 2026-05-21T00:00 → from gameClock = 25h, from real = ~11h
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 943,
      lastTurnProcessed: new Date("2026-05-19T23:00:00Z"),
      isActive: true,
      pausedAt: null,
      effectiveNow: new Date("2026-05-19T23:00:00Z"),
      startingYear: 2019,
    });
    const clock = await getGameClock();
    const result = clock.formatRemaining(new Date("2026-05-21T00:00:00Z"));
    expect(result.text).toBe("1d 1h"); // 25h from gameClock
  });

  it("returns null pauseReason/pauseKind when fields absent", async () => {
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 943,
      lastTurnProcessed: new Date("2026-05-19T23:00:00Z"),
      isActive: true,
      pausedAt: null,
      effectiveNow: new Date("2026-05-19T23:00:00Z"),
      startingYear: 2019,
    });
    mockDbWithPauseFields(null, null);
    const clock = await getGameClock();
    expect(clock.pauseReason).toBeNull();
    expect(clock.pauseKind).toBeNull();
  });

  it("formatYear honors the per-game startingYear (1991 preset)", async () => {
    const lastTurnProcessed = new Date("2026-05-19T23:00:00Z");
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 1,
      lastTurnProcessed,
      isActive: true,
      pausedAt: null,
      effectiveNow: lastTurnProcessed,
      startingYear: 1991,
    });
    const clock = await getGameClock();
    // 60 turns (= 60h) past turn 1 lands in game-year 2 → 1992, not 2020.
    const sixtyTurnsAhead = new Date(lastTurnProcessed.getTime() + 60 * 3_600_000);
    expect(clock.formatYear(sixtyTurnsAhead)).toBe(1992);
  });
});

describe("getGameClock turn-based helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T22:00:00Z"));
    mockDbWithPauseFields(null, null);
  });

  it("formatRemainingTurns counts whole turns ahead of currentTurn (1 turn = 1h)", async () => {
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed: new Date("2026-05-29T01:00:00Z"),
      isActive: true,
      pausedAt: null,
      effectiveNow: new Date("2026-05-29T01:00:00Z"),
      startingYear: 2019,
    });
    const clock = await getGameClock();
    expect(clock.formatRemainingTurns(124).text).toBe("24 turns (~1d)"); // 24 turns = ~1 day
    expect(clock.formatRemainingTurns(100).urgency).toBe("ended"); // due now
    expect(clock.formatRemainingTurns(99).urgency).toBe("ended"); // past
    expect(clock.formatRemainingTurns(null).text).toBe("No timer");
  });

  it("projectTurnToDate = realNow + (targetTurn - currentTurn) * 1h", async () => {
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed: new Date("2026-05-29T01:00:00Z"),
      isActive: true,
      pausedAt: null,
      effectiveNow: new Date("2026-05-29T01:00:00Z"),
      startingYear: 2019,
    });
    const clock = await getGameClock();
    // realNow is 2026-05-29T22:00; +2 turns = +2h.
    expect(clock.projectTurnToDate(102)?.toISOString()).toBe("2026-05-30T00:00:00.000Z");
    expect(clock.projectTurnToDate(null)).toBeNull();
  });
});

describe("getGameClock.formatAbsoluteDeadline / toAbsoluteWallClock", () => {
  const realNow = new Date("2026-05-20T13:11:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(realNow);
    mockDbWithPauseFields(null, null);
  });

  it("returns deadline unchanged when driftMs == 0", async () => {
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed: realNow,
      isActive: true,
      pausedAt: null,
      effectiveNow: realNow,
      startingYear: 2019,
    });
    const clock = await getGameClock();
    const deadline = new Date("2026-05-30T00:42:00Z");
    expect(clock.toAbsoluteWallClock(deadline)?.toISOString()).toBe(deadline.toISOString());
  });

  it("shifts forward by driftMs when drifted (no pause)", async () => {
    const lastTurnProcessed = new Date(realNow.getTime() - 3 * 3_600_000); // 3h drift
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed,
      isActive: true,
      pausedAt: null,
      effectiveNow: lastTurnProcessed,
      startingYear: 2019,
    });
    const clock = await getGameClock();
    const deadline = new Date("2026-05-30T00:42:00Z");
    const shifted = clock.toAbsoluteWallClock(deadline);
    expect(shifted?.getTime()).toBe(deadline.getTime() + 3 * 3_600_000);
  });

  it("shifts forward by drift+pause when paused", async () => {
    // 1h drift accrued before pause, then 2h paused → 3h total drift from lastTurnProcessed.
    const lastTurnProcessed = new Date(realNow.getTime() - 3 * 3_600_000);
    const pausedAt = new Date(realNow.getTime() - 2 * 3_600_000);
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed,
      isActive: false,
      pausedAt,
      effectiveNow: pausedAt,
      startingYear: 2019,
    });
    const clock = await getGameClock();
    const deadline = new Date("2026-05-30T00:42:00Z");
    expect(clock.toAbsoluteWallClock(deadline)?.getTime()).toBe(deadline.getTime() + 3 * 3_600_000);
  });

  it("returns null / '—' for nullish or invalid input", async () => {
    vi.mocked(gameTimeMod.getGameTime).mockResolvedValue({
      currentTurn: 100,
      lastTurnProcessed: realNow,
      isActive: true,
      pausedAt: null,
      effectiveNow: realNow,
      startingYear: 2019,
    });
    const clock = await getGameClock();
    expect(clock.toAbsoluteWallClock(null)).toBeNull();
    expect(clock.toAbsoluteWallClock(undefined)).toBeNull();
    expect(clock.toAbsoluteWallClock("not-a-date")).toBeNull();
    expect(clock.formatAbsoluteDeadline(null)).toBe("—");
  });
});
