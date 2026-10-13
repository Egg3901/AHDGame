import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  capacityHaircutFactor,
  EXTRACTION_CAPACITY_HAIRCUT_FLOOR,
  EXTRACTION_NO_BUYER_PHASE_OUT_TURNS,
  noBuyerHaircutFloor,
  noBuyerPhaseOutProgress,
} from "./capacityHaircut";
import { resolveNoBuyerPhaseOutStartTurn } from "./noBuyerPhaseOutStart";
import { resolveSectorCapacityHaircut } from "@/lib/turn/corporation/sectorCapacityHaircut";
import type { CorporateSector } from "@/lib/db/types";

const deadMine = (capacityHaircutStartTurn: number) =>
  ({
    _id: new ObjectId(),
    sectorType: "extraction",
    capacityHaircutStartTurn,
    capacityUtilization: 0,
  }) as unknown as CorporateSector;

describe("no-buyer phase-out progress", () => {
  it("runs from 0 to 1 over 24 turns from the start stamp", () => {
    expect(EXTRACTION_NO_BUYER_PHASE_OUT_TURNS).toBe(24);
    expect(noBuyerPhaseOutProgress(undefined, 100)).toBe(0);
    expect(noBuyerPhaseOutProgress(100, 100)).toBe(0);
    expect(noBuyerPhaseOutProgress(100, 112)).toBeCloseTo(0.5);
    expect(noBuyerPhaseOutProgress(100, 124)).toBe(1);
    expect(noBuyerPhaseOutProgress(100, 500)).toBe(1);
  });

  it("lowers the 0.5 haircut floor linearly to 0", () => {
    expect(noBuyerHaircutFloor(0)).toBe(EXTRACTION_CAPACITY_HAIRCUT_FLOOR);
    expect(noBuyerHaircutFloor(0.5)).toBeCloseTo(0.25);
    expect(noBuyerHaircutFloor(1)).toBe(0);
  });

  it("leaves the haircut byte-identical when no phase-out applies", () => {
    for (const [util, start, turn] of [
      [0, 77, 152],
      [0.4, 10, 300],
      [0.9, null, 10],
      [0, 50, 50],
    ] as const) {
      expect(capacityHaircutFactor(util, start, turn, 0.5, 0)).toBe(
        capacityHaircutFactor(util, start, turn, 0.5)
      );
    }
  });
});

describe("resolveSectorCapacityHaircut with the no-buyer phase-out", () => {
  // A dead-deposit mine 75 turns into the 240-turn ramp: 0.6875 realized today.
  const utilMap = new Map([["x", { utilization: 0, bindingResource: null }]]);
  const mine = deadMine(77);
  const util = new Map([[mine._id.toString(), utilMap.get("x")!]]);

  it("keeps today's factor before the phase-out starts", () => {
    expect(resolveSectorCapacityHaircut(mine, util, 152, 0).capacityHaircut).toBeCloseTo(0.6875);
  });

  it("closes to 0 by the end of the window, never in one step", () => {
    const series = [0, 6, 12, 18, 24].map(
      (t) =>
        resolveSectorCapacityHaircut(mine, util, 152 + t, noBuyerPhaseOutProgress(152, 152 + t))
          .capacityHaircut
    );
    expect(series[0]).toBeCloseTo(0.6875);
    expect(series[2]).toBeCloseTo(0.5);
    expect(series[4]).toBe(0);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThanOrEqual(series[i - 1]);
      expect(series[i - 1] - series[i]).toBeLessThan(0.26);
    }
  });
});

describe("resolveNoBuyerPhaseOutStartTurn", () => {
  const dbWith = () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    return { db: { collection: vi.fn(() => ({ updateOne })) } as unknown as Db, updateOne };
  };

  it("reuses an existing stamp without writing", async () => {
    const { db, updateOne } = dbWith();
    expect(
      await resolveNoBuyerPhaseOutStartTurn(db, { extractionNoBuyerPhaseOutStartTurn: 150 }, 170)
    ).toBe(150);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("stamps the current turn once, only when unset", async () => {
    const { db, updateOne } = dbWith();
    expect(await resolveNoBuyerPhaseOutStartTurn(db, {}, 170)).toBe(170);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "default", extractionNoBuyerPhaseOutStartTurn: { $exists: false } },
      { $set: { extractionNoBuyerPhaseOutStartTurn: 170 } }
    );
  });

  it("does nothing on a world with no gameConfig document", async () => {
    const { db, updateOne } = dbWith();
    expect(await resolveNoBuyerPhaseOutStartTurn(db, null, 170)).toBeUndefined();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
