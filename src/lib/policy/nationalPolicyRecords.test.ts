import { describe, expect, it } from "vitest";

import type { FederalBudget, LegislationType } from "@/lib/db/types";
import { backfillNationalTaxPolicyRecords, buildPolicyResponse } from "./nationalPolicyRecords";

const modernIncomeTax = {
  _id: "dd.tax.incomeTax",
  name: "Wage Tax Act",
  policyDomain: "tax",
  taxSlider: {
    scope: "federal",
    taxType: "incomeTax",
    minRate: 0,
    maxRate: 60,
    step: 1,
    baselineRate: 12,
    waypoints: [],
  },
} as unknown as LegislationType;

const legacyIncomeTax = {
  _id: "dd_income_tax",
  name: "Citizens' Income Tax Statute",
  policyDomain: "tax",
  taxRateChange: { scope: "federal", taxType: "incomeTax" },
  policyOptions: [
    { id: "low", name: "12%", rate: 12, economic: 0, social: 0 },
    { id: "high", name: "30%", rate: 30, economic: -2, social: 0 },
  ],
} as unknown as LegislationType;

describe("national tax policy records", () => {
  it("shows the enacted rate encoded by a modern tax-slider policy", () => {
    const row = buildPolicyResponse(
      {
        scope: "national",
        stateId: "dd_national",
        legislationTypeId: modernIncomeTax._id,
        policyOptionId: "rate:16",
        economic: -0.67,
        social: 0,
        updatedAt: new Date(0),
      },
      modernIncomeTax
    );

    expect(row.policyOptionName).toBe("Rate: 16%");
  });

  it("shows the live budget rate and the enacted target while a tax rate phases in", () => {
    const row = buildPolicyResponse(
      {
        scope: "national",
        stateId: "dd_national",
        legislationTypeId: modernIncomeTax._id,
        policyOptionId: "rate:16",
        economic: -0.67,
        social: 0,
        updatedAt: new Date(0),
      },
      modernIncomeTax,
      null,
      {
        _id: "DD",
        taxRates: { incomeTax: 12 },
        taxRatePhaseIn: { incomeTax: 16 },
      } as unknown as FederalBudget
    );

    expect(row.policyOptionName).toBe("Rate: 12% (target 16%, phasing in)");
  });

  it("does not backfill a second legacy law for a tax type controlled by a modern record", () => {
    const records = new Map([
      [
        modernIncomeTax._id,
        {
          scope: "national" as const,
          stateId: "dd_national",
          legislationTypeId: modernIncomeTax._id,
          policyOptionId: "rate:16",
          economic: -0.67,
          social: 0,
          updatedAt: new Date(0),
        },
      ],
    ]);

    backfillNationalTaxPolicyRecords({
      budget: {
        _id: "DD",
        taxRates: { incomeTax: 16 },
      } as unknown as FederalBudget,
      legislationTypes: [modernIncomeTax, legacyIncomeTax],
      nationalStateId: "dd_national",
      recordsByCanonicalId: records,
    });

    expect(records.has(legacyIncomeTax._id)).toBe(false);
  });
});
