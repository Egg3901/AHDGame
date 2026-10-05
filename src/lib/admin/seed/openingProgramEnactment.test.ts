import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { recordEnactedLaw } from "@/lib/budget/enactedLaws";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import { scaleProgramCostModel } from "@/lib/seeds/reference/rules/openingProgramCostScale";
import { makeBill } from "@/lib/test-utils/factories";
import { createMockDb } from "@/lib/test-utils/mockDb";

describe("1991 calibrated policy dial enactment", () => {
  it.each([
    ["US", "us.defense.armedForces.primary", 6_200_000_000_000, 252_177_000],
    ["UK", "uk.health.universalCare.primary", 600_000_000_000, 57_500_000],
  ] as const)(
    "%s keeps the quoted expense fractions after a new level is enacted",
    async (countryId, lawId, gdp, population) => {
      const law = getLaw(lawId)!;
      const type = projectLawToLegislationType(law);
      const base = { gdp, population };
      const scale = 0.72;
      type.policyOptions = type.policyOptions!.map((option) => ({
        ...option,
        costModelV2: scaleProgramCostModel(option.costModelV2!, scale),
      }));
      const option = type.policyOptions[4]!;
      const quote = computeLawCost(
        { name: "", description: "", ...option.costModelV2 },
        base,
        countryId,
        null
      );
      const raw = computeLawCost(law.levels![4], base, countryId, null);
      const db = createMockDb();
      const enacted = await recordEnactedLaw(
        db as unknown as Db,
        makeBill({ countryId }),
        type,
        1991,
        "national",
        undefined,
        option,
        quote.revenue
      );
      const accrued = calculateEnactedLawAnnualCost(enacted, {
        gdp,
        population,
        countryId,
        budgetCapacity: 1,
        year: 1991,
        v2Base: base,
      });
      expect(quote.cost).toBeCloseTo(raw.cost * scale, 0);
      expect(quote.revenue).toBe(raw.revenue);
      expect(accrued).toBe(quote.cost);
      expect(enacted.costModelV2).toEqual(option.costModelV2);
      expect(enacted.policyOptionIndex).toBe(4);
    }
  );
});
