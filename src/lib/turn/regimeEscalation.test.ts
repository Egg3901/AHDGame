import { describe, it, expect } from "vitest";
import {
  STAGE_THRESHOLDS,
  computeNextStage,
  updateDwellCounters,
  type StageInputs,
  type DwellUpdateInputs,
} from "@/lib/turn/regimeEscalation";

const ZERO_DWELL = {
  stage1: 0,
  stage2: { sustained: 0, cumulativeIn168: 0 },
  stage3: 0,
  stage4: 0,
};

describe("STAGE_THRESHOLDS", () => {
  it("matches the design table", () => {
    expect(STAGE_THRESHOLDS.stage1.entryPopular).toBe(60);
    expect(STAGE_THRESHOLDS.stage1.dwellTurns).toBe(12);

    expect(STAGE_THRESHOLDS.stage2.entryPopular).toBe(35);
    expect(STAGE_THRESHOLDS.stage2.dwellSustained).toBe(36);
    expect(STAGE_THRESHOLDS.stage2.dwellCumulative).toBe(48);
    expect(STAGE_THRESHOLDS.stage2.windowTurns).toBe(168);

    expect(STAGE_THRESHOLDS.stage3.entryPartyConfidence).toBe(15);
    expect(STAGE_THRESHOLDS.stage3.dwellTurns).toBe(24);

    expect(STAGE_THRESHOLDS.stage4.entryPopular).toBe(15);
    expect(STAGE_THRESHOLDS.stage4.dwellTurns).toBe(72);
  });
});

describe("updateDwellCounters", () => {
  function baseInputs(overrides: Partial<DwellUpdateInputs> = {}): DwellUpdateInputs {
    return {
      previous: ZERO_DWELL,
      popularLegitimacy: 80,
      partyConfidence: 70,
      currentStage: "stable",
      conventionInProgress: false,
      windowSizeTurns: 168,
      ...overrides,
    };
  }

  it("increments stage1 when popularLegitimacy at or below 60", () => {
    const out = updateDwellCounters(baseInputs({ popularLegitimacy: 60 }));
    expect(out.stage1).toBe(1);
  });

  it("decrements stage1 when popularLegitimacy above threshold", () => {
    const out = updateDwellCounters(
      baseInputs({
        previous: { ...ZERO_DWELL, stage1: 10 },
        popularLegitimacy: 80,
      })
    );
    expect(out.stage1).toBe(9);
  });

  it("clamps stage1 counter at zero on sustained recovery", () => {
    let counters = { ...ZERO_DWELL, stage1: 5 };
    for (let i = 0; i < 100; i++) {
      counters = updateDwellCounters(
        baseInputs({
          previous: counters,
          popularLegitimacy: 90,
        })
      );
    }
    expect(counters.stage1).toBe(0);
  });

  it("increments stage2.sustained + cumulativeIn168 when popular <= 35", () => {
    const out = updateDwellCounters(baseInputs({ popularLegitimacy: 30 }));
    expect(out.stage2.sustained).toBe(1);
    expect(out.stage2.cumulativeIn168).toBe(1);
  });

  it("resets stage2.sustained on recovery but cumulativeIn168 decays slowly", () => {
    const out = updateDwellCounters(
      baseInputs({
        previous: { ...ZERO_DWELL, stage2: { sustained: 20, cumulativeIn168: 40 } },
        popularLegitimacy: 80,
      })
    );
    expect(out.stage2.sustained).toBe(19); // decremented by 1
    expect(out.stage2.cumulativeIn168).toBeLessThanOrEqual(40); // erodes, doesn't reset
  });

  it("increments stage3 when partyConfidence < 15", () => {
    const out = updateDwellCounters(baseInputs({ partyConfidence: 14 }));
    expect(out.stage3).toBe(1);
  });

  it("decrements stage3 when partyConfidence >= 15", () => {
    const out = updateDwellCounters(
      baseInputs({
        previous: { ...ZERO_DWELL, stage3: 10 },
        partyConfidence: 20,
      })
    );
    expect(out.stage3).toBe(9);
  });

  it("increments stage4 only when popular < 15 AND currentStage >= internalChallenge", () => {
    const out = updateDwellCounters(
      baseInputs({
        popularLegitimacy: 10,
        currentStage: "internalChallenge",
      })
    );
    expect(out.stage4).toBe(1);
  });

  it("does NOT increment stage4 when popular < 15 but currentStage < internalChallenge", () => {
    const out = updateDwellCounters(
      baseInputs({
        popularLegitimacy: 10,
        currentStage: "crisis",
      })
    );
    expect(out.stage4).toBe(0);
  });

  it("freezes stage4 counter while conventionInProgress", () => {
    const out = updateDwellCounters(
      baseInputs({
        previous: { ...ZERO_DWELL, stage4: 50 },
        popularLegitimacy: 5,
        partyConfidence: 5,
        currentStage: "internalChallenge",
        conventionInProgress: true,
      })
    );
    expect(out.stage4).toBe(50);
  });
});

describe("computeNextStage", () => {
  function baseInputs(overrides: Partial<StageInputs> = {}): StageInputs {
    return {
      popularLegitimacy: 80,
      partyConfidence: 80,
      dwellCounters: ZERO_DWELL,
      currentStage: "stable",
      conventionInProgress: false,
      ...overrides,
    };
  }

  it("stays stable when everything is healthy", () => {
    expect(computeNextStage(baseInputs())).toBe("stable");
  });

  it("transitions to discontent when stage1 dwell crosses 12 + popular ≤ 60", () => {
    expect(
      computeNextStage(
        baseInputs({
          popularLegitimacy: 50,
          dwellCounters: { ...ZERO_DWELL, stage1: 12 },
        })
      )
    ).toBe("discontent");
  });

  it("does NOT transition to discontent before stage1 dwell crosses 12", () => {
    expect(
      computeNextStage(
        baseInputs({
          popularLegitimacy: 50,
          dwellCounters: { ...ZERO_DWELL, stage1: 11 },
        })
      )
    ).toBe("stable");
  });

  it("transitions to crisis when stage2 sustained dwell crosses 36", () => {
    expect(
      computeNextStage(
        baseInputs({
          currentStage: "discontent",
          popularLegitimacy: 30,
          dwellCounters: {
            stage1: 12,
            stage2: { sustained: 36, cumulativeIn168: 36 },
            stage3: 0,
            stage4: 0,
          },
        })
      )
    ).toBe("crisis");
  });

  it("transitions to crisis on cumulative 48 even without 36 sustained", () => {
    expect(
      computeNextStage(
        baseInputs({
          currentStage: "discontent",
          popularLegitimacy: 30,
          dwellCounters: {
            stage1: 12,
            stage2: { sustained: 10, cumulativeIn168: 48 },
            stage3: 0,
            stage4: 0,
          },
        })
      )
    ).toBe("crisis");
  });

  it("transitions to internalChallenge at partyConfidence <15 dwell ≥24", () => {
    expect(
      computeNextStage(
        baseInputs({
          currentStage: "crisis",
          partyConfidence: 14,
          dwellCounters: {
            stage1: 12,
            stage2: { sustained: 36, cumulativeIn168: 48 },
            stage3: 24,
            stage4: 0,
          },
        })
      )
    ).toBe("internalChallenge");
  });

  it("transitions to collapse only when Stage 3 is active AND no convention", () => {
    expect(
      computeNextStage(
        baseInputs({
          currentStage: "internalChallenge",
          popularLegitimacy: 10,
          partyConfidence: 5,
          dwellCounters: {
            stage1: 12,
            stage2: { sustained: 36, cumulativeIn168: 48 },
            stage3: 24,
            stage4: 72,
          },
        })
      )
    ).toBe("collapse");
  });

  it("does NOT transition to collapse while conventionInProgress", () => {
    expect(
      computeNextStage(
        baseInputs({
          currentStage: "internalChallenge",
          popularLegitimacy: 10,
          partyConfidence: 5,
          dwellCounters: {
            stage1: 12,
            stage2: { sustained: 36, cumulativeIn168: 48 },
            stage3: 24,
            stage4: 72,
          },
          conventionInProgress: true,
        })
      )
    ).toBe("internalChallenge");
  });

  it("does NOT regress stages — once at collapse, stays at collapse", () => {
    expect(
      computeNextStage(
        baseInputs({
          currentStage: "collapse",
          popularLegitimacy: 90,
          partyConfidence: 90,
        })
      )
    ).toBe("collapse");
  });

  it("does NOT regress to stable from discontent when popular recovers", () => {
    // Recovery from a stage requires explicit decision-event action
    // (Phase 4). Pure stage compute is forward-only.
    expect(
      computeNextStage(
        baseInputs({
          currentStage: "discontent",
          popularLegitimacy: 90,
          dwellCounters: ZERO_DWELL,
        })
      )
    ).toBe("discontent");
  });
});
