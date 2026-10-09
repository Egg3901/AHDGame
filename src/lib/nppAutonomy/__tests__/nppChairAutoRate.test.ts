import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  computeNppChairRateTarget,
  computeNppChairRateStep,
  processNppChairAutoRate,
  isStandingAdviceDue,
} from "../nppChairAutoRate";
import { RATE_HISTORY_MAX } from "@/lib/db/types/centralBank";
import { SYSTEM_RATE_ACTOR } from "@/lib/centralBank/rateHistory";

describe("computeNppChairRateTarget", () => {
  it("hikes above neutral when inflation is hot", () => {
    const target = computeNppChairRateTarget({
      neutralRate: 4.0,
      inflationRate: 5.0,
      targetInflation: 2.0,
      gdpGrowth: 2.0,
    });
    // 4.0 + 1.0*(5-2) + 0.5*(2-2) = 7.0
    expect(target).toBeCloseTo(7.0, 6);
  });

  it("cuts below neutral when growth is below target", () => {
    const target = computeNppChairRateTarget({
      neutralRate: 4.0,
      inflationRate: 2.0,
      targetInflation: 2.0,
      gdpGrowth: -1.0,
    });
    // 4.0 + 0 + 0.5*(-1-2) = 2.5
    expect(target).toBeCloseTo(2.5, 6);
  });

  it("stagflation resolves by the larger gap", () => {
    const target = computeNppChairRateTarget({
      neutralRate: 4.0,
      inflationRate: 4.0, // +2.0 inflation term (gap 4-2 = 2)
      targetInflation: 2.0,
      gdpGrowth: 0.0, // -1.0 growth term
    });
    // 4.0 + 2.0 - 1.0 = 5.0 (net hike because inflation gap dominates)
    expect(target).toBeCloseTo(5.0, 6);
  });
});

describe("computeNppChairRateStep", () => {
  it("moves a fraction of the gap, clamped to hike cap", () => {
    // gap = 10 - 2 = 8; 0.5*8 = 4 -> clamp to +0.75
    expect(computeNppChairRateStep({ currentRate: 2.0, targetRate: 10.0 })).toBeCloseTo(0.75, 6);
  });

  it("clamps to the cut cap", () => {
    // gap = 2 - 10 = -8; 0.5*-8 = -4 -> clamp to -1.75
    expect(computeNppChairRateStep({ currentRate: 10.0, targetRate: 2.0 })).toBeCloseTo(-1.75, 6);
  });

  it("returns ~0 when already at target", () => {
    expect(computeNppChairRateStep({ currentRate: 4.0, targetRate: 4.0 })).toBeCloseTo(0, 6);
  });

  it("keeps the ordinary hike cap while inflation is near target", () => {
    expect(
      computeNppChairRateStep({ currentRate: 2.0, targetRate: 10.0, inflationGap: 4.5 })
    ).toBeCloseTo(0.75, 6);
  });

  it("widens the hike clamp once inflation is far over target", () => {
    // 0.5 * 8 = 4 -> clamp to +3.0
    expect(
      computeNppChairRateStep({ currentRate: 2.0, targetRate: 10.0, inflationGap: 8 })
    ).toBeCloseTo(3.0, 6);
    // still proportional below the wide clamp: 0.5 * 4 = 2
    expect(
      computeNppChairRateStep({ currentRate: 2.0, targetRate: 6.0, inflationGap: 8 })
    ).toBeCloseTo(2.0, 6);
  });

  it("leaves cuts alone when inflation is far over target", () => {
    expect(
      computeNppChairRateStep({ currentRate: 10.0, targetRate: 2.0, inflationGap: 8 })
    ).toBeCloseTo(-1.75, 6);
  });

  it("never hikes past the policy-rate ceiling", () => {
    expect(
      computeNppChairRateStep({ currentRate: 24, targetRate: 80, inflationGap: 70 })
    ).toBeCloseTo(1, 6);
    expect(computeNppChairRateStep({ currentRate: 25, targetRate: 80, inflationGap: 70 })).toBe(0);
  });

  it("closes a 16% and a 64% inflation gap in a handful of moves, not years", () => {
    const movesToTarget = (inflation: number, neutral: number) => {
      const target = Math.min(neutral + (inflation - 2), 25);
      let rate = 9.5;
      let moves = 0;
      while (Math.abs(target - rate) > 0.5 && moves < 200) {
        const step = computeNppChairRateStep({
          currentRate: rate,
          targetRate: target,
          inflationGap: inflation - 2,
        });
        rate = Math.round((rate + step) / 0.25) * 0.25;
        moves++;
      }
      return moves;
    };
    // Each move waits RATE_CHANGE_COOLDOWN_TURNS (6) turns.
    expect(movesToTarget(16, 4)).toBeLessThanOrEqual(4);
    expect(movesToTarget(64, 4)).toBeLessThanOrEqual(8);
  });
});

function mockRateDb(budget: any, nationalMetrics: any, npp: any = null) {
  const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
  const db = {
    collection: (name: string) => ({
      updateOne,
      findOne: async (_q: any) => {
        if (name === "federalBudget") return budget;
        if (name === "stateMetrics") return nationalMetrics;
        if (name === "npps") return npp;
        return null;
      },
    }),
  } as any;
  return { db, updateOne };
}

/** The $push half of the single update the setter issues. */
function pushedRecord(updateOne: ReturnType<typeof vi.fn>) {
  const op = updateOne.mock.calls[0] as unknown as [
    unknown,
    { $push?: { rateHistory: { $each: any[]; $slice: number } } },
  ];
  return op[1].$push?.rateHistory;
}

describe("processNppChairAutoRate", () => {
  it("hikes primeRate when inflation hot and writes lastRateChangeTurn", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 5.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    // US defaultPrimeRate = 3.0 -> target = 3.0 + 1.0*(5-2) + 0 = 6.0; step = 0.5*(6-4) = 1.0 -> +0.75
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);
    expect(updateOne).toHaveBeenCalled();
    const callArgs = updateOne.mock.calls[0] as unknown as [
      unknown,
      { $set: { primeRate: number; lastRateChangeTurn: number } },
    ];
    const op = callArgs[1];
    expect(op.$set.primeRate).toBeGreaterThan(4.0);
    expect(op.$set.lastRateChangeTurn).toBe(50);
  });

  it("hikes by more than the ordinary cap when inflation is far over target", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 64 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 9.5,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);
    const op = updateOne.mock.calls[0] as unknown as [unknown, { $set: { primeRate: number } }];
    expect(op[1].$set.primeRate).toBe(12.5);
  });

  it("is a no-op within the cooldown window", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 9.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: 48, // 50-48 = 2 < 6
      chairMode: "npp",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when step is ~0", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 2.0 } }, // at target
      { economic: { gdpGrowth: { value: 2.0 } } } // at target
    );
    // US defaultPrimeRate = 3.0 -> target = 3.0; primeRate 3.0 -> step 0
    const bank = {
      _id: "b" as any,
      primeRate: 3.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when chairMode !== 'npp'", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 9.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
      chairMode: "character",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when chairMode is unset", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 9.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);
    expect(updateOne).not.toHaveBeenCalled();
  });
  it("writes a rate on the quarter-point grid the rate API enforces", async () => {
    // Ticket #1238: the Taylor rule produces a continuous value. Storing it raw
    // left the US bank at 4.653426586881501, and because the rate card offers
    // base +/-0.25, every value the next human chair could submit was also
    // off-grid and refused with "Rate must be in 0.25% increments".
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 5.3 } },
      { economic: { gdpGrowth: { value: 1.7 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.653426586881501,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;

    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);

    expect(updateOne).toHaveBeenCalled();
    const op = (
      updateOne.mock.calls[0] as unknown as [unknown, { $set: { primeRate: number } }]
    )[1];
    const written = op.$set.primeRate;
    expect(written * 4).toBe(Math.round(written * 4));
  });

  it("records the autonomous move in the published rate history", async () => {
    // #1250: the setter moved the rate and wrote nothing, so the bank's history
    // showed only the last HUMAN change however long ago that was. The UK had
    // moved to 0.25% behind a completely empty ledger, leaving no way to see
    // who moved the rate or when.
    const nppId = new ObjectId();
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 5.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } },
      { _id: nppId, name: "Iris Marchetti" }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
      chairNppId: nppId,
    } as any;

    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);

    const pushed = pushedRecord(updateOne);
    expect(pushed).toBeDefined();
    expect(pushed!.$each).toHaveLength(1);
    const record = pushed!.$each[0];
    expect(record.previousRate).toBe(4.0);
    expect(record.newRate).toBeGreaterThan(4.0);
    expect(record.changedBy).toBe(nppId);
    expect(record.changedByName).toContain("Iris Marchetti");
    expect(record.reason).toMatch(/Taylor rule/i);
    // Same cap as the committee and direct-set writers, so no path truncates
    // another's records.
    expect(pushed!.$slice).toBe(-RATE_HISTORY_MAX);
  });

  it("attributes an unidentifiable autonomous chair rather than dropping the record", async () => {
    // changedBy is a required ObjectId. A bank whose NPP cannot be resolved must
    // still have its move recorded, under the system actor.
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 5.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;

    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);

    const record = pushedRecord(updateOne)!.$each[0];
    expect(record.changedBy).toEqual(SYSTEM_RATE_ACTOR);
    expect(record.changedByName).toBe("Autonomous chair");
  });

  it("writes no history entry when the move is a no-op", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 2.02 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 3.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;

    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("leaves a government-controlled bank alone while the government is using the rate", async () => {
    // #1250: the gate was `chairMode !== "npp"` and nothing else, so the
    // autonomous chair kept setting Bank Rate on a bank whose rate belongs to
    // the Treasury. Because the government shares the one `lastRateChangeTurn`
    // cooldown field, every write slammed the Chancellor's window shut and the
    // rate card sat permanently on "on cooldown".
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 7.63 } },
      { economic: { gdpGrowth: { value: -2.254 } } }
    );
    const bank = {
      _id: "UK" as any,
      primeRate: 0.25,
      lastRateChangeTurn: 695,
      chairMode: "npp",
    } as any;

    // Era START 1953 < BOE_INDEPENDENCE_YEAR, and no explicit statute, so the
    // UK bank resolves to government-controlled. The government moved the rate
    // five turns ago, inside the idle window, so nothing happens.
    await processNppChairAutoRate(db, bank, "UK" as any, 700, 1963, false, 1953);

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("acts on standing advice once the government has left the rate alone for a quarter", async () => {
    // The 1991 UK sat at 4.5% for 28 turns through 15% inflation because the
    // government never used the lever. After GOVERNMENT_RATE_IDLE_TURNS the
    // Treasury applies the bank's bounded Taylor step, without touching the
    // government's own cooldown field (#1250).
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 15 } },
      { economic: { gdpGrowth: { value: 9 } } }
    );
    const bank = { _id: "UK" as any, primeRate: 4.5, chairMode: "npp" } as any;

    await processNppChairAutoRate(db, bank, "UK" as any, 28, 1991, false, 1991);

    expect(updateOne).toHaveBeenCalledTimes(1);
    const op = (
      updateOne.mock.calls[0] as unknown as [unknown, { $set: Record<string, unknown> }]
    )[1];
    expect(op.$set.primeRate).toBe(7.5);
    expect(op.$set.lastStandingAdviceTurn).toBe(28);
    expect(op.$set).not.toHaveProperty("lastRateChangeTurn");
    const pushed = pushedRecord(updateOne)!;
    expect(pushed.$each[0].changedByName).toBe("Treasury, on the bank's standing advice");
    expect(pushed.$each[0].changedBy).toBe(SYSTEM_RATE_ACTOR);
  });

  it("paces standing-advice moves by the normal cooldown", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 15 } },
      { economic: { gdpGrowth: { value: 9 } } }
    );
    const recent = {
      _id: "UK" as any,
      primeRate: 5.25,
      chairMode: "npp",
      lastStandingAdviceTurn: 26,
    } as any;
    await processNppChairAutoRate(db, recent, "UK" as any, 30, 1991, false, 1991);
    expect(updateOne).not.toHaveBeenCalled();

    const due = {
      _id: "UK" as any,
      primeRate: 5.25,
      chairMode: "npp",
      lastStandingAdviceTurn: 24,
    } as any;
    await processNppChairAutoRate(db, due, "UK" as any, 30, 1991, false, 1991);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});

describe("isStandingAdviceDue", () => {
  it("counts the idle window from world start when the government never moved", () => {
    expect(isStandingAdviceDue({}, 11)).toBe(false);
    expect(isStandingAdviceDue({}, 12)).toBe(true);
  });

  it("restarts the idle window after any government move", () => {
    expect(isStandingAdviceDue({ lastRateChangeTurn: 40, lastStandingAdviceTurn: 30 }, 51)).toBe(
      false
    );
    expect(isStandingAdviceDue({ lastRateChangeTurn: 40, lastStandingAdviceTurn: 30 }, 52)).toBe(
      true
    );
  });

  it("waits a cooldown between its own moves", () => {
    expect(isStandingAdviceDue({ lastRateChangeTurn: 0, lastStandingAdviceTurn: 20 }, 25)).toBe(
      false
    );
    expect(isStandingAdviceDue({ lastRateChangeTurn: 0, lastStandingAdviceTurn: 20 }, 26)).toBe(
      true
    );
  });
});

describe("processNppChairAutoRate (independence and cooldown)", () => {
  it("still runs for the UK once independence has been granted by statute", async () => {
    // An explicit `governmentControlled: false` written by legislation beats the
    // historical default, and the technocrat chair takes the rate back.
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 7.63 } },
      { economic: { gdpGrowth: { value: -2.254 } } }
    );
    const bank = {
      _id: "UK" as any,
      primeRate: 0.25,
      lastRateChangeTurn: null,
      chairMode: "npp",
      governmentControlled: false,
    } as any;

    await processNppChairAutoRate(db, bank, "UK" as any, 700, 1963, false, 1953);

    expect(updateOne).toHaveBeenCalled();
  });

  it("still runs for a country that was never government-controlled", async () => {
    // The gate must key on governance, not merely on an era that predates 1997:
    // only the UK is in HISTORICALLY_GOVERNMENT_CONTROLLED.
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 5.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;

    await processNppChairAutoRate(db, bank, "US" as any, 700, 1963, false, 1953);

    expect(updateOne).toHaveBeenCalled();
  });

  it("does not burn the cooldown when snapping lands back on the current rate", async () => {
    // A sub-quarter-point step rounds to the rate the bank already has. Writing
    // that would stamp lastRateChangeTurn for a move that never happened.
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 2.02 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 3.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;

    await processNppChairAutoRate(db, bank, "US" as any, 50, null, false, 2019);

    expect(updateOne).not.toHaveBeenCalled();
  });
});
