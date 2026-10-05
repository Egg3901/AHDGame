import { describe, expect, it } from "vitest";
import { NATIONAL_BASELINES_1979 } from "../seeds/nationalBaselines1979";
import { NATIONAL_BASELINES_1991 } from "../seeds/nationalBaselines1991";
import { planPoliticalOpening1991 } from "./repair1991";
import type { PoliticalMetricId } from "../types";

describe("1991 in-place political repair", () => {
  it("preserves player score changes and structural residual distance", () => {
    const values = { ...NATIONAL_BASELINES_1979.RU, "governance.openness": 50 };
    const residuals = Object.fromEntries(
      Object.entries(values).map(([id, value]) => [id, value - 20])
    ) as Record<PoliticalMetricId, number>;
    const result = planPoliticalOpening1991({ _id: "CEN", countryId: "RU", values, residuals })!;
    const change = 50 - NATIONAL_BASELINES_1979.RU["governance.openness"];
    expect(result.values["governance.openness"]).toBeCloseTo(
      NATIONAL_BASELINES_1991.RU["governance.openness"] + change
    );
    for (const id of Object.keys(values) as PoliticalMetricId[]) {
      expect(result.values[id] - result.residuals![id]).toBeCloseTo(20);
    }
    expect(planPoliticalOpening1991({ _id: "CEN", countryId: "RU", ...result })).toBeNull();
  });
  it("leaves Japan's already-authored derived board alone", () => {
    expect(
      planPoliticalOpening1991({ _id: "KAN", countryId: "JP", values: NATIONAL_BASELINES_1979.US })
    ).toBeNull();
  });
  it("rejects missing scores rather than inventing player changes", () => {
    const values = { ...NATIONAL_BASELINES_1979.US, "economy.stability": NaN };
    expect(() => planPoliticalOpening1991({ _id: "CA", countryId: "US", values })).toThrow(
      /Invalid political value/
    );
  });
});
