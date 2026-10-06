import { describe, expect, it } from "vitest";
import type { ResetRegionalOpeningBoard } from "@/lib/resetFinance/rules/regionalOpeningBoard";
import type { OpeningLawReference } from "@/lib/resetLegislation/openingLaw";
import type { ResetMetricSnapshot } from "@/lib/resetMetrics/rules/snapshot";
import { buildSuccessorMetricRows, buildSuccessorRegionalRows } from "./resetV2Promotion";

const aggregateMetric = {
  _id: "UK:SCO",
  worldId: "world-a",
  countryId: "UK",
  scope: "regional",
  regionId: "SCO",
  sourceTurn: 1,
  asOfTurn: 8,
  observations: { unemployment: { metricId: "unemployment", value: 8 } },
  history: { unemployment: [{ turn: 1, value: 8 }] },
} as unknown as ResetMetricSnapshot;

const aggregateFiscal: ResetRegionalOpeningBoard = {
  _id: "UK:SCO",
  worldId: "world-a",
  countryId: "UK",
  regionId: "SCO",
  sourceTurn: 1,
  annualSpending: 1_000,
  familyOwned: 600,
  otherExistingServices: 400,
  allocatedClaims: [{ sourceId: "source-a", familyId: "L01", annualBooked: 600 }],
  estimateKind: "proportional-source-pool",
};

const reference = {
  key: "SCO:regional:L01",
  familyId: "L01",
  country: "SCO",
  scope: "regional",
  sourceComponents: [{ sourceId: "source-a", annualBooked: 600 }],
} as unknown as OpeningLawReference;

describe("successor reset v2 promotion rules", () => {
  it("uses the departing region aggregate for both sovereign and sub-region metrics", () => {
    const rows = buildSuccessorMetricRows({
      countryId: "SCO",
      aggregate: aggregateMetric,
      regions: [
        { id: "LOT", population: 2 },
        { id: "HGL", population: 1 },
      ],
    });

    expect(rows.map((row) => row._id)).toEqual(["SCO:national", "SCO:LOT", "SCO:HGL"]);
    expect(rows[0]).toMatchObject({ countryId: "SCO", scope: "national" });
    expect(rows[0]!.regionId).toBeUndefined();
    expect(rows.every((row) => row.observations.unemployment!.value === 8)).toBe(true);
  });

  it("conserves the aggregate fiscal book and assigns each sub-region only its share", () => {
    const rows = buildSuccessorRegionalRows({
      countryId: "SCO",
      aggregate: aggregateFiscal,
      regionalReferences: [reference],
      regions: [
        { id: "LOT", population: 2 },
        { id: "HGL", population: 1 },
      ],
    });

    expect(rows[0]!.fiscal.annualSpending).toBeCloseTo(1_000 * (2 / 3));
    expect(rows[1]!.fiscal.annualSpending).toBeCloseTo(1_000 * (1 / 3));
    expect(rows.reduce((sum, row) => sum + row.fiscal.annualSpending, 0)).toBeCloseTo(1_000);
    expect(rows.reduce((sum, row) => sum + row.fiscal.familyOwned, 0)).toBeCloseTo(600);
    expect(rows[0]!.references[0]!.sourceComponents[0]!.annualBooked).toBeCloseTo(400);
    expect(rows[1]!.references[0]!.sourceComponents[0]!.annualBooked).toBeCloseTo(200);
  });

  it("rejects missing or invalid population inputs", () => {
    expect(() =>
      buildSuccessorRegionalRows({
        countryId: "WAL",
        aggregate: aggregateFiscal,
        regionalReferences: [reference],
        regions: [{ id: "CDF", population: 0 }],
      })
    ).toThrow("invalid sub-region population");
  });
});
