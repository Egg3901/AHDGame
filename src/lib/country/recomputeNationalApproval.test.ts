import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BASE_APPROVAL, computeNationalAveragesFromMetrics } from "@/lib/utils/governmentApproval";

const { basesMock } = vi.hoisted(() => ({ basesMock: vi.fn() }));

vi.mock("@/lib/politicalLegislation/politicalApprovalProvider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/politicalLegislation/politicalApprovalProvider")
  >()),
  loadPoliticalApprovalBases: (...args: unknown[]) => basesMock(...args),
}));

import { recomputeNationalApproval, type RecomputeInputs } from "./recomputeNationalApproval";

/**
 * A country outside `BOARD_COUNTRIES`, which every id in `COUNTRY_ORDER` is
 * currently inside. The legacy metric branches below are therefore unreachable
 * in production today — they are covered anyway because they were lifted
 * verbatim out of `loadNationalApproval` and must keep behaving as they did if a
 * country is ever added outside the board set.
 */
const UNBOARDED = "ZZ" as CountryId;

function makeStateMetrics(stateId: string, medianIncome: number): StateMetrics {
  return {
    _id: stateId,
    economic: { medianIncome: { value: medianIncome } },
    education: { highSchoolGradRate: { value: 90 } },
    healthcare: { uninsuredRate: { value: 10 } },
  } as StateMetrics;
}

/** Inputs in the shape `loadNationalApproval` hands over, so no queries are needed. */
function inputs(
  allMetrics: StateMetrics[],
  populations: Record<string, number> = {}
): RecomputeInputs {
  return {
    allStates: allMetrics.map((m) => ({
      _id: String(m._id),
      population: populations[String(m._id)] ?? 0,
    })) as RecomputeInputs["allStates"],
    allMetrics,
    nationalAverages: allMetrics.length > 0 ? computeNationalAveragesFromMetrics(allMetrics) : {},
    preset: "2019-default",
    year: null,
  };
}

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("stateDemographics").find().toArray.mockResolvedValue([]);
  basesMock.mockReset().mockResolvedValue(null);
});

describe("recomputeNationalApproval", () => {
  it("reads the hybrid political bases for a board country", async () => {
    // The real path for every country in the game, and the one the war-entry
    // gate depends on. SP4 no-divergence rule: a board country must never reach
    // the legacy metric scorer, even with metrics present that would disagree.
    basesMock.mockResolvedValue({ national: 49.5 });

    const result = await recomputeNationalApproval(
      db as unknown as Db,
      "FR",
      inputs([makeStateMetrics("idf", 90000)], { idf: 1000 })
    );

    expect(result).toBe(49.5);
  });

  it("falls back to the base rating when a board country has no political bases", async () => {
    // Pre-seed, or a world whose preset carries no politicalMetrics docs.
    basesMock.mockResolvedValue(null);

    const result = await recomputeNationalApproval(
      db as unknown as Db,
      "FR",
      inputs([makeStateMetrics("idf", 90000)], { idf: 1000 })
    );

    expect(result).toBe(BASE_APPROVAL);
  });

  it("scores an unboarded country above the base when its populous states beat the average", async () => {
    const metrics = [makeStateMetrics("rich", 90000), makeStateMetrics("poor", 30000)];

    const result = await recomputeNationalApproval(
      db as unknown as Db,
      UNBOARDED,
      inputs(metrics, { rich: 900, poor: 100 })
    );

    expect(result).toBeGreaterThan(BASE_APPROVAL);
  });

  it("scores an unboarded country below the base when its populous states trail the average", async () => {
    const metrics = [makeStateMetrics("rich", 90000), makeStateMetrics("poor", 30000)];

    const result = await recomputeNationalApproval(
      db as unknown as Db,
      UNBOARDED,
      inputs(metrics, { rich: 100, poor: 900 })
    );

    expect(result).toBeLessThan(BASE_APPROVAL);
  });

  it("falls back to the base rating when an unboarded country has no metrics", async () => {
    const result = await recomputeNationalApproval(db as unknown as Db, UNBOARDED, inputs([]));

    expect(result).toBe(BASE_APPROVAL);
  });

  it("queries for its own inputs when a caller hands none over", async () => {
    // The war-entry gate calls it this way -- it holds no metrics of its own.
    basesMock.mockResolvedValue({ national: 52.5 });
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "idf", population: 1000 }]);
    db.collection("stateMetrics").find().toArray.mockResolvedValue([]);

    const result = await recomputeNationalApproval(db as unknown as Db, "FR");

    expect(result).toBe(52.5);
  });
});
