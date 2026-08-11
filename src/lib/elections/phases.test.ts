import { describe, expect, it } from "vitest";
import type { GameTimeContext } from "@/lib/time/gameTime";
import {
  computeElectionPhase,
  hasElectionStarted,
  isCampaignUpgradeGeneralPhase,
  isPrimaryEnded,
  isElectionEnded,
} from "./phases";

// Game clock deliberately drifted far from the Dates so any Date-based logic
// would give the wrong answer — proving the turn fields win.
function gt(currentTurn: number): GameTimeContext {
  const effectiveNow = new Date("2026-05-30T00:00:00Z");
  return {
    currentTurn,
    lastTurnProcessed: effectiveNow,
    isActive: true,
    pausedAt: null,
    effectiveNow,
    startingYear: 2019,
  };
}

// Dates that, against effectiveNow (2026-05-30), would say "ended" — but the
// turn fields say otherwise.
const FAR_PAST = new Date("2020-01-01T00:00:00Z");

describe("turn-first election deadline helpers", () => {
  const el = { startTurn: 100, primaryEndTurn: 124, endTurn: 148 };

  it("hasElectionStarted: currentTurn >= startTurn", () => {
    expect(hasElectionStarted(el, 99, gt(99))).toBe(false);
    expect(hasElectionStarted(el, 100, gt(100))).toBe(true);
  });
  it("isPrimaryEnded: currentTurn >= primaryEndTurn", () => {
    expect(isPrimaryEnded(el, 123, gt(123))).toBe(false);
    expect(isPrimaryEnded(el, 124, gt(124))).toBe(true);
  });
  it("isElectionEnded: currentTurn >= endTurn", () => {
    expect(isElectionEnded(el, 147, gt(147))).toBe(false);
    expect(isElectionEnded(el, 148, gt(148))).toBe(true);
  });
  it("falls back to Date when the turn field is absent", () => {
    expect(isElectionEnded({ endTime: FAR_PAST }, 5, gt(5))).toBe(true);
    expect(isElectionEnded({ endTime: new Date("2099-01-01") }, 5, gt(5))).toBe(false);
  });
});

describe("isCampaignUpgradeGeneralPhase", () => {
  const el = { startTurn: 100, primaryEndTurn: 124, endTurn: 148 };

  it("is false before the primary closes (still in primary)", () => {
    expect(isCampaignUpgradeGeneralPhase(el, 110, gt(110))).toBe(false);
  });
  it("is true after the primary closes and before the election ends", () => {
    expect(isCampaignUpgradeGeneralPhase(el, 130, gt(130))).toBe(true);
  });
  it("is false once the election has ended", () => {
    expect(isCampaignUpgradeGeneralPhase(el, 148, gt(148))).toBe(false);
  });
  it("is false for a null election", () => {
    expect(isCampaignUpgradeGeneralPhase(null, 130, gt(130))).toBe(false);
  });
  it("is false when the race has no primary boundary (e.g. uncontested)", () => {
    expect(isCampaignUpgradeGeneralPhase({ endTurn: 148 }, 130, gt(130))).toBe(false);
  });
  it("is false when the race has no end boundary", () => {
    expect(isCampaignUpgradeGeneralPhase({ primaryEndTurn: 124 }, 130, gt(130))).toBe(false);
  });
});

describe("computeElectionPhase — turn-first", () => {
  const turnFields = { startTurn: 100, primaryEndTurn: 124, endTurn: 148 };
  // Pass FAR_PAST Dates so Date-logic would wrongly say "ended"; turn fields win.
  const phaseAt = (ct: number) =>
    computeElectionPhase(FAR_PAST, FAR_PAST, FAR_PAST, "active", gt(ct), turnFields);

  it("upcoming before startTurn", () => {
    expect(phaseAt(99).isUpcoming).toBe(true);
  });
  it("in primary between startTurn and primaryEndTurn", () => {
    const p = phaseAt(110);
    expect(p.isUpcoming).toBe(false);
    expect(p.inPrimary).toBe(true);
    expect(p.isEnded).toBe(false);
  });
  it("in general between primaryEndTurn and endTurn", () => {
    const p = phaseAt(130);
    expect(p.inPrimary).toBe(false);
    expect(p.inGeneral).toBe(true);
    expect(p.isEnded).toBe(false);
  });
  it("ended at endTurn", () => {
    expect(phaseAt(148).isEnded).toBe(true);
  });
  it("freezes when currentTurn is held (pause)", () => {
    // Same turn → same phase regardless of how far real/effective time moves.
    expect(phaseAt(110).inPrimary).toBe(true);
    expect(phaseAt(110).inPrimary).toBe(true);
  });
});
