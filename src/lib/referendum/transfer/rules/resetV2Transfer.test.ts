import { describe, expect, it } from "vitest";
import { buildOpeningRegionalBoards1991 } from "@/lib/resetFinance/openingRegionalBoards1991";
import { buildOpeningLawBoards1991 } from "@/lib/resetLegislation/openingBoards1991";
import { buildOpeningMetricSnapshots1991 } from "@/lib/resetMetrics/seedOpening1991";
import {
  transferResetV2FiscalToIreland,
  transferResetV2LawToIreland,
  transferResetV2MetricToIreland,
} from "./resetV2Transfer";

describe("Northern Ireland v2 board transfer", () => {
  it("rekeys metric history, law lineage, and regional funding into Ireland", () => {
    const worldId = "reunification-world";
    const metric = buildOpeningMetricSnapshots1991(worldId, 1).find((row) => row._id === "UK:NIR")!;
    const law = buildOpeningLawBoards1991(worldId, 1).find((row) => row._id === "UK:NIR")!;
    const fiscal = buildOpeningRegionalBoards1991(worldId, 1).find((row) => row._id === "UK:NIR")!;

    const movedMetric = transferResetV2MetricToIreland(metric, "NIR");
    const movedLaw = transferResetV2LawToIreland(law, "NIR");
    const movedFiscal = transferResetV2FiscalToIreland(fiscal, "NIR");

    expect(movedMetric).toMatchObject({ _id: "IE:NIR", countryId: "IE", regionId: "NIR" });
    expect(movedMetric.observations).not.toBe(metric.observations);
    expect(movedLaw).toMatchObject({
      _id: "IE:NIR",
      countryId: "IE",
      regionId: "NIR",
      scope: "regional",
    });
    expect(movedLaw.ukTerritorialTax).toBeUndefined();
    expect(Object.values(movedLaw.references)).toHaveLength(60);
    expect(
      Object.values(movedLaw.references).every(
        (reference) =>
          reference.country === "IE" &&
          reference.scope === "regional" &&
          reference.key === `IE:regional:${reference.familyId}`
      )
    ).toBe(true);
    expect(movedFiscal).toMatchObject({ _id: "IE:NIR", countryId: "IE", regionId: "NIR" });
    expect(movedFiscal.allocatedClaims).not.toBe(fiscal.allocatedClaims);
    expect(movedFiscal.annualSpending).toBe(fiscal.annualSpending);
  });
});
