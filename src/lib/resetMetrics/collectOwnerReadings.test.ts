import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import {
  openingGrossPurchasingInputs1991,
  openingLifeCalibration1991,
  openingHealthProxyReferences1991,
} from "./openingSeed1991";
import { collectResetMetricOwnerReadings } from "./collectOwnerReadings";
import { refreshResetMetricBoard } from "./rules/refresh";

const boards = buildOpeningMetricSnapshots1991("test-world", 1);
const opening = openingGrossPurchasingInputs1991();
const lifeOpening = openingLifeCalibration1991();

function mockOwnerSources(db: ReturnType<typeof createMockDb>) {
  db.collection("macroMetrics").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(
      boards
        .filter((board) => board.scope === "regional")
        .map((board) => {
          const source = opening[board.countryId][board.regionId!]!;
          return {
            _id: board.regionId,
            countryId: board.countryId,
            economic: {
              medianIncome: { value: source.medianIncome },
              costOfLiving: { value: source.basketIndex },
            },
          };
        })
    ),
  });
  db.collection("federalBudget").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(
      ["US", "UK", "JP"].map((countryId) => ({
        countryId,
        gdp: 1_000,
        revenue: { total: 90 },
        spending: { total: 100 },
        surplus: 999,
        debt: { principal: 500 },
        economicFactors: { inflationRate: 4 },
      }))
    ),
  });
}

describe("first live v2 metric owners", () => {
  it("updates health proxies on cadence with fixed reference stocks and retains the NHS wait index", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    const references = openingHealthProxyReferences1991();
    const regional = (["US", "UK", "JP"] as const).map((country) =>
      boards.find((board) => board.countryId === country && board.scope === "regional")!
    );
    db.collection("stateMetrics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        regional.map((board) => ({
          _id: board.regionId,
          countryId: board.countryId,
          healthcare: {
            physicianRate: { value: references[board.countryId].physicianRate * 1.2 },
            publicHealthPreparedness: { value: references[board.countryId].preparedness * 1.2 },
            uninsuredRate: { value: 20 },
            nhsWaitingTime: { value: 27 },
          },
        }))
      ),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, regional, 13);
    expect(readings[regional[0]!._id]!.updates["16"]?.value).toBe(80);
    expect(readings[regional[1]!._id]!.updates["16"]?.value).toBeCloseTo(98);
    expect(readings[regional[2]!._id]!.updates["16"]?.value).toBeCloseTo(98);
    expect(readings[regional[1]!._id]!.updates["18"]?.value).toBe(27);
    expect(readings[regional[0]!._id]!.updates["18"]?.value).toBeCloseTo(20 / 1.2);
    expect(readings[regional[2]!._id]!.updates["18"]?.status).toBe("proxy");
    expect(db.collectionMocks.stateMetrics!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.stateMetrics!.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projection: expect.objectContaining({ "healthcare.physicianRate.value": 1 }),
      })
    );
  });
  it("does not refresh health off cadence or accept another country's health stocks", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    const pa = boards.find((board) => board._id === "US:PA")!;
    await collectResetMetricOwnerReadings(db as unknown as Db, [pa], 2);
    expect(db.collectionMocks.stateMetrics).toBeUndefined();
    db.collection("stateMetrics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "PA",
          countryId: "UK",
          healthcare: {
            physicianRate: { value: 10 },
            publicHealthPreparedness: { value: 100 },
            uninsuredRate: { value: 0 },
          },
        },
      ]),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, [pa], 13);
    expect(readings[pa._id]!.updates["16"]).toBeUndefined();
    expect(readings[pa._id]!.updates["18"]).toBeUndefined();
  });
  it("collects per-turn fiscal and purchasing readings in two projected reads", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 2);
    expect(Object.keys(readings)).toHaveLength(74);
    expect(readings["US:national"]!.updates["07"]?.value).toBe(4);
    expect(readings["US:national"]!.updates["09"]?.value).toBe(-1);
    expect(readings["US:national"]!.updates["10"]?.value).toBe(50);
    expect(db.collectionMocks.federalBudget!.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projection: expect.objectContaining({
          "revenue.total": 1,
          "spending.total": 1,
        }),
      })
    );
    const pennsylvania = boards.find((board) => board._id === "US:PA")!;
    expect(readings["US:PA"]!.updates["02"]?.value).toBeCloseTo(
      pennsylvania.observations["02"]!.value!
    );
    expect(db.collectionMocks.macroMetrics!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.federalBudget!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.militaryUnits).toBeUndefined();
  });

  it("recomputes national readiness from live roster condition on its 12-turn cadence", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    db.collection("militaryUnits").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        ["US", "UK", "JP"].map((countryId) => ({
          countryId,
          basePower: 100,
          readiness: 80,
          integrity: 50,
          supply: 100,
          readyAtTurn: 1,
        }))
      ),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 13);
    expect(readings["US:national"]!.updates["57"]?.value).toBe(40);
    expect(readings["UK:national"]!.updates["57"]?.value).toBe(40);
    expect(db.collectionMocks.militaryUnits!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.militaryUnits!.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projection: expect.objectContaining({
          basePower: 1,
          readiness: 1,
          integrity: 1,
          supply: 1,
        }),
      })
    );
  });

  it("withholds readiness if a country has no military roster", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    db.collection("militaryUnits").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 13);
    expect(readings["US:national"]!.updates["57"]).toBeUndefined();
  });

  it("reads realized cohort-owner outcomes only from this turn's receipt", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    db.collection("militaryUnits").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("macroMetrics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "PA",
          countryId: "US",
          resetCohortReading: {
            asOfTurn: 49,
            populationGrowthAnnualized: 1.3,
            realizedTfr: 2.07,
            dependencyBurden15To64: 50,
            periodLifeExpectancy: lifeOpening.US.PA!.modeledYears + 1,
          },
        },
      ]),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 49);
    expect(readings["US:PA"]!.cohortDue).toBe(true);
    expect(readings["US:PA"]!.updates["56"]?.value).toBe(50);
    expect(readings["US:PA"]!.updates["54"]?.value).toBe(1.3);
    expect(readings["US:PA"]!.updates["55"]?.value).toBe(2.07);
    expect(readings["US:PA"]!.updates["20"]?.value).toBeCloseTo(
      lifeOpening.US.PA!.openingYears + 1
    );
    expect(db.collectionMocks.regionDemographics).toBeUndefined();
  });

  it("reads model-owned economic results without flattening regional differences or reading political scores", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    db.collection("macroMetrics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "PA",
          countryId: "US",
          economic: {
            unemploymentRate: { value: 6.2 },
            povertyRate: { value: 12.3 },
            gdpGrowth: { value: 1.8 },
            productivityGrowth: { value: 1.1 },
            tradeBalance: { value: -2.4 },
          },
        },
        {
          _id: "CA",
          countryId: "US",
          economic: {
            unemploymentRate: { value: 8.4 },
            povertyRate: { value: 10.1 },
            gdpGrowth: { value: 2.6 },
            productivityGrowth: { value: 1.9 },
            tradeBalance: { value: 1.6 },
          },
        },
      ]),
    });
    db.collection("militaryUnits").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 49);
    expect(readings["US:PA"]!.updates["01"]?.value).toBe(6.2);
    expect(readings["US:CA"]!.updates["01"]?.value).toBe(8.4);
    expect(readings["US:PA"]!.updates["03"]?.value).toBe(12.3);
    expect(readings["US:CA"]!.updates["05"]?.value).toBe(2.6);
    expect(readings["US:PA"]!.updates["06"]?.value).toBe(1.1);
    expect(readings["US:PA"]!.updates["08"]?.value).toBe(-2.4);
    expect(readings["US:CA"]!.updates["08"]?.value).toBe(1.6);
    expect(readings["US:PA"]!.updates["14"]).toMatchObject({
      status: "proxy",
      source: "provisional continuity owner: higher_education",
    });
    expect(readings["US:PA"]!.updates["16"]).toBeUndefined();
    expect(db.collectionMocks.politicalMetrics).toBeUndefined();
  });

  it("rejects a macro row assigned to another country", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    db.collection("macroMetrics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "PA",
          countryId: "UK",
          economic: { unemploymentRate: { value: 99 } },
        },
      ]),
    });
    db.collection("militaryUnits").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 49);
    expect(readings["US:PA"]!.updates["01"]).toBeUndefined();
  });

  it("refuses to treat an old cohort receipt as this year's outcome", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    db.collection("militaryUnits").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("macroMetrics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "PA",
          countryId: "US",
          resetCohortReading: {
            asOfTurn: 48,
            populationGrowthAnnualized: 1,
            realizedTfr: 2,
            dependencyBurden15To64: 50,
          },
        },
      ]),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 49);
    expect(readings["US:PA"]!.cohortDue).toBe(true);
    expect(readings["US:PA"]!.updates["54"]).toBeUndefined();
    expect(readings["US:PA"]!.updates["55"]).toBeUndefined();
    expect(readings["US:PA"]!.updates["56"]).toBeUndefined();
    const board = { ...boards.find((candidate) => candidate._id === "US:PA")!, asOfTurn: 48 };
    const result = refreshResetMetricBoard({
      board,
      turn: 49,
      ...readings["US:PA"]!,
    });
    expect(result.missingDueIds).toEqual(expect.arrayContaining(["54", "55", "56"]));
  });

  it("uses the frozen 1991 purchasing anchor rather than compounding yesterday's index", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    const advanced = boards.map((board) => ({ ...board, asOfTurn: 2 }));
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, advanced, 3);
    const pennsylvania = boards.find((board) => board._id === "US:PA")!;
    expect(readings["US:PA"]!.updates["02"]?.value).toBeCloseTo(
      pennsylvania.observations["02"]!.value!
    );
  });

  it("can collect the same owner readings again after a partial same-turn write", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    const partlyWritten = boards.map((board, index) =>
      index < 10 ? { ...board, asOfTurn: 2 } : board
    );
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, partlyWritten, 2);
    expect(readings["US:national"]!.updates["07"]?.value).toBe(4);
    expect(readings["US:PA"]!.updates["02"]?.value).toBeTypeOf("number");
  });

  it("withholds an owner reading when its physical input is missing", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    db.collection("federalBudget").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 2);
    expect(readings["US:national"]!.updates["07"]).toBeUndefined();
    expect(readings["US:national"]!.updates["09"]).toBeUndefined();
    expect(readings["US:national"]!.updates["10"]).toBeUndefined();
    expect(readings["US:national"]!.updates["58"]).toBeUndefined();
  });

  it("provides an explicitly provisional owner for every non-physical due metric", async () => {
    const db = createMockDb();
    mockOwnerSources(db);
    const readings = await collectResetMetricOwnerReadings(db as unknown as Db, boards, 2);
    for (const board of boards) {
      const due = refreshResetMetricBoard({ board, turn: 2, ...readings[board._id]! });
      expect(due.missingDueIds.filter((id) => !FAIL_CLOSED_TEST_IDS.has(id))).toEqual([]);
    }
  });
});

const FAIL_CLOSED_TEST_IDS = new Set([
  "01",
  "03",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "16",
  "18",
  "20",
  "54",
  "55",
  "56",
  "57",
]);
