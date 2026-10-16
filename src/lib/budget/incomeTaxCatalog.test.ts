import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { expandIncomeTaxTypes } from "./incomeTaxCatalog";
import { alignSeedIncomeTaxTierRecords } from "./incomeTaxSeedPolicies";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Db } from "mongodb";
describe("capital-gains provision catalog", () => {
  it("expands discrete and slider income laws idempotently without copying macro effects", () => {
    const source = {
      _id: "example",
      name: "Income tax",
      countryScope: "br",
      taxSlider: { scope: "federal", taxType: "incomeTax", min: 0, max: 100, step: 1 },
      administration: { policyFamilyId: "example" },
      effectTarget: "economic",
      demographicEffects: { wealth: { high: -1 } },
      policyOptions: [{ id: "rate:20", rate: 20, budgetCost: 100 }],
    } as unknown as LegislationType;
    const expanded = expandIncomeTaxTypes([source]);
    const capital = expanded.filter((type) => type._id.includes("__capital_"));
    expect(capital).toHaveLength(3);
    expect(capital.map((type) => type.taxRateChange?.taxType)).toEqual([
      "capitalGainsTaxLow",
      "capitalGainsTaxMiddle",
      "capitalGainsTaxHigh",
    ]);
    expect(expandIncomeTaxTypes(expanded)).toEqual(expanded);
    for (const type of capital) {
      expect(type.taxSlider?.taxType).toBe(type.taxRateChange?.taxType);
      expect(type.administration?.policyFamilyId).toBe(type._id);
      expect(type.effectTarget).toBeUndefined();
      expect(type.demographicEffects).toBeUndefined();
      expect(type.policyOptions![0]).toMatchObject({ budgetCost: 0 });
    }
  });
  it("aligns capital policy targets with their own tier rather than the income rate", async () => {
    const memory = createInMemoryDb();
    memory.seed("federalBudget", [
      {
        _id: "BR",
        countryId: "BR",
        taxRates: { incomeTaxLow: 10, capitalGainsTaxLow: 3 },
        taxRatePhaseIn: { capitalGainsTaxLow: 7 },
      },
    ]);
    memory.seed("legislationTypes", [
      {
        _id: "example__capital_low",
        countryScope: "br",
        taxRateChange: { scope: "federal", taxType: "capitalGainsTaxLow" },
      },
    ]);
    const aligned = await alignSeedIncomeTaxTierRecords(memory as unknown as Db, [
      {
        scope: "national",
        stateId: "BR",
        legislationTypeId: "example__capital_low",
        policyOptionId: "rate:10",
      },
    ]);
    expect(aligned[0].policyOptionId).toBe("rate:7");
  });
});
