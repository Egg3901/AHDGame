import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { MediaProductProject } from "./mediaProduct";
import {
  attributeMediaProductSales,
  mediaProductOfferAvailability,
  paidPoliticalMediaSellerReceipts,
  persistMediaProductSales,
  reconcileMediaProductDelivery,
} from "./mediaProductSales";
import type { SectorClearingResult } from "@/lib/market/clearing";

function project(overrides: Partial<MediaProductProject> = {}): MediaProductProject {
  return {
    _id: "paper",
    corporationId: "corp-1",
    sectorId: "sector-1",
    kindId: "newspaper_edition",
    title: "Daily Record",
    allocationShare: 0.5,
    stage: "mature",
    startedTurn: 1,
    stageStartedTurn: 2,
    developmentPaidAnchor: 20_000,
    paidThresholdAnchor: 10_000,
    elapsedDevelopmentTurns: 2,
    elapsedThresholdTurns: 2,
    developmentAdvertisingAnchor: 2_000,
    developmentAdvertisingTurns: 2,
    ...overrides,
  };
}

describe("media product sales attribution", () => {
  it("counts only applied or replayed political seller receipts", () => {
    const sellers = [
      { sectorId: "sector-a", units: 5, amountAnchor: 50 },
      { sectorId: "sector-b", units: 7, amountAnchor: 70 },
    ];
    expect(
      paidPoliticalMediaSellerReceipts({
        sellers,
        results: [{ status: "applied" }, { status: "rejected" }],
      })
    ).toEqual([sellers[0]]);
    expect(
      paidPoliticalMediaSellerReceipts({
        sellers,
        results: [],
        orderAlreadySettled: true,
      })
    ).toEqual(sellers);
  });

  it("caps titles inside existing output and removes retired titles from the offer", () => {
    const projects = [
      project(),
      project({
        _id: "series",
        kindId: "television_series",
        allocationShare: 0.25,
        stage: "decline",
      }),
      project({
        _id: "old-book",
        kindId: "book",
        allocationShare: 0.4,
        stage: "retired",
      }),
    ];

    const availability = mediaProductOfferAvailability(projects);
    expect(availability.advertising).toBeCloseTo(0.415);
    // These titles do not produce entertainment services, so they leave that
    // existing physical offer untouched.
    expect(availability.entertainment_services).toBe(1);
  });

  it("attributes actual cleared units and tail revenue without adding output", () => {
    const projects = [
      project(),
      project({
        _id: "series",
        kindId: "television_series",
        allocationShare: 0.25,
        stage: "decline",
      }),
      project({
        _id: "old-paper",
        stage: "retired",
      }),
    ];
    const clearing: SectorClearingResult = {
      factor: 1,
      soldFraction: 0.415,
      effectivePosture: 0,
      soldByCommodity: { advertising: 0.415 },
      deliveredUnitsByCommodity: { advertising: 41.5 },
      offerFactorByCommodity: { advertising: 1 },
    };
    const attributed = attributeMediaProductSales({
      projects,
      clearing,
      basePrices: { advertising: 100 },
      turn: 12,
    });

    expect(attributed).toHaveLength(2);
    expect(
      attributed.find((row) => row.projectId === "paper")?.deliveredUnitsByCommodity.advertising
    ).toBeCloseTo(7.5);
    expect(
      attributed.find((row) => row.projectId === "paper")?.deliveredRevenueAnchorByCommodity
        .advertising
    ).toBeCloseTo(750);
    expect(
      attributed.find((row) => row.projectId === "series")?.deliveredUnitsByCommodity.advertising
    ).toBeCloseTo(9);
    expect(
      attributed.find((row) => row.projectId === "series")?.deliveredRevenueAnchorByCommodity
        .advertising
    ).toBeCloseTo(900);
    const titleUnits = attributed.reduce(
      (sum, row) => sum + (row.deliveredUnitsByCommodity.advertising ?? 0),
      0
    );
    expect(titleUnits).toBeLessThanOrEqual(clearing.deliveredUnitsByCommodity?.advertising ?? 0);
  });

  it("removes unpaid political plans and credits only applied seller receipts", () => {
    const projectRow = project();
    const plannedClearing: SectorClearingResult = {
      factor: 1,
      soldFraction: 0.415,
      effectivePosture: 0,
      soldByCommodity: { advertising: 0.415 },
      deliveredUnitsByCommodity: { advertising: 41.5 },
      offerFactorByCommodity: { advertising: 1 },
    };
    const reconciled = reconcileMediaProductDelivery({
      clearing: plannedClearing,
      plannedPoliticalUnits: 15,
      paidPoliticalSeller: { units: 9, amountAnchor: 900 },
    });
    const [attribution] = attributeMediaProductSales({
      projects: [projectRow],
      clearing: reconciled.clearing,
      basePrices: { advertising: 100 },
      turn: 12,
      paidPoliticalUnitsByCommodity: reconciled.paidPoliticalUnitsByCommodity,
      paidPoliticalRevenueAnchorByCommodity: reconciled.paidPoliticalRevenueAnchorByCommodity,
    });

    expect(reconciled.clearing.deliveredUnitsByCommodity?.advertising).toBeCloseTo(35.5);
    expect(reconciled.paidPoliticalUnitsByCommodity.advertising).toBe(9);
    expect(reconciled.paidPoliticalRevenueAnchorByCommodity.advertising).toBe(900);
    expect(attribution?.deliveredUnitsByCommodity.advertising).toBeCloseTo(4.63);
    expect(attribution?.deliveredRevenueAnchorByCommodity.advertising).toBeCloseTo(463.04);
  });

  it("freezes per-turn attribution with an idempotent project-turn write", async () => {
    const bulkWrite = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: vi.fn(() => ({ bulkWrite })),
    } as unknown as Db;

    await persistMediaProductSales(db, [
      {
        projectId: "paper",
        corporationId: "corp-1",
        turn: 12,
        deliveredUnitsByCommodity: { advertising: 7.5 },
        deliveredRevenueAnchorByCommodity: { advertising: 750 },
      },
    ]);

    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: {
              _id: "paper",
              corporationId: "corp-1",
              $or: [
                { lastDeliveredOutputTurn: { $exists: false } },
                { lastDeliveredOutputTurn: { $lt: 12 } },
              ],
            },
            update: {
              $set: {
                lastDeliveredOutputTurn: 12,
                lastTurnDeliveredUnitsByCommodity: { advertising: 7.5 },
                lastTurnDeliveredRevenueAnchorByCommodity: { advertising: 750 },
              },
              $inc: {
                "lifetimeDeliveredUnitsByCommodity.advertising": 7.5,
                "lifetimeDeliveredRevenueAnchorByCommodity.advertising": 750,
              },
            },
          },
        },
      ],
      { ordered: false }
    );
  });
});
