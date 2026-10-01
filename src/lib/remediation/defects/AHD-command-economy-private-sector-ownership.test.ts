import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  DEFECT_ID,
  KNOWN_SECTOR_IDS,
  administrativeBookValueAnchor,
  buildAdministrativeSectorMerge,
  defect,
} from "./AHD-command-economy-private-sector-ownership";

describe("command-economy ownership repair valuation", () => {
  it("uses paid queue cost when a corrupt negative CIP would erase live construction", () => {
    expect(
      administrativeBookValueAnchor({
        sectorType: "technology",
        capacityBookAnchor: 4_492.986570879902,
        constructionInProgressAnchor: -12,
        buildQueue: [
          { unitsOrdered: 1, costPaidAnchor: 8.753431363493558, startTurn: 300, onlineTurn: 324 },
          { unitsOrdered: 1, costPaidAnchor: 8.737568837914935, startTurn: 301, onlineTurn: 325 },
        ],
      })
    ).toBeCloseTo(4_510.47757108131, 9);
  });

  it("uses the larger of recorded CIP and the queue total", () => {
    expect(
      administrativeBookValueAnchor({
        sectorType: "media",
        capacityBookAnchor: 12_403.610080694778,
        constructionInProgressAnchor: 3,
        buildQueue: [],
      })
    ).toBeCloseTo(12_406.610080694778, 9);
  });
});

describe("command-economy ownership repair merge", () => {
  it("preserves the full plant and current-turn operating state without a taking haircut", () => {
    const sourceId = new ObjectId();
    const update = buildAdministrativeSectorMerge(
      {
        sectorType: "technology",
        revenue: 100,
        realizedRevenue: 120,
        workers: 10,
        currentGrowthCost: 4,
        laborCost: 5,
        producedUnits: 7,
        soldUnits: 6,
        capitalStock: 30,
        capacityBookAnchor: 40,
        constructionInProgressAnchor: 10,
        buildQueue: [],
      },
      {
        sectorType: "technology",
        revenue: 25,
        realizedRevenue: 35,
        workers: 3,
        currentGrowthCost: 2,
        laborCost: 4,
        producedUnits: 5,
        soldUnits: 4,
        capitalStock: 20,
        capacityBookAnchor: 30,
        constructionInProgressAnchor: -2,
        buildQueue: [{ unitsOrdered: 2, costPaidAnchor: 6, startTurn: 5, onlineTurn: 9 }],
      },
      sourceId,
      new Date("2026-08-22T00:00:00Z"),
      "run-test"
    );

    expect(update.$inc).toMatchObject({
      revenue: 25,
      realizedRevenue: 35,
      workers: 3,
      currentGrowthCost: 2,
      laborCost: 4,
      producedUnits: 5,
      soldUnits: 4,
    });
    expect(update.$set).toMatchObject({
      capitalStock: 50,
      capacityBookAnchor: 70,
      constructionInProgressAnchor: 16,
      buildQueue: [{ unitsOrdered: 2, costPaidAnchor: 6, startTurn: 5, onlineTurn: 9 }],
      [`remediation.${DEFECT_ID}.${sourceId.toString()}`]: {
        runId: "run-test",
        mergedAt: new Date("2026-08-22T00:00:00Z"),
      },
    });
  });
});

describe("command-economy ownership repair registration", () => {
  it("pins only the eight audited sectors", () => {
    expect(KNOWN_SECTOR_IDS).toHaveLength(8);
    expect(new Set(KNOWN_SECTOR_IDS).size).toBe(8);
  });

  it("is production-only, bounded, idempotent, and money-conserving", () => {
    expect(defect.envs).toEqual(["prod"]);
    expect(defect.idempotent).toBe(true);
    expect(defect.mintsMoney).not.toBe(true);
    expect(defect.guards).toContain("turn-lock-free");
    expect(defect.guards).toContain("max-affected:8");
    expect(defect.guards).toContain("money-conserving");
    expect(defect.codeFix?.requiredCommit).toBe("23c23601254109f382085bca00f85ccd38149545");
    expect(defect.seedFix.status).toBe("fixed");
  });
});
