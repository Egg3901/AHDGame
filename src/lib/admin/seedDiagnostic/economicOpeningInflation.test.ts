import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { checkEconomicOpening } from "./economicOpening";

async function inflationChecks(budgets: unknown[]) {
  const db = createMockDb();
  db.collection("federalBudget");
  db.collectionMocks.federalBudget.find.mockReturnValue({
    toArray: async () => budgets,
  });
  const checks = await checkEconomicOpening(db as unknown as Db, "1991-default");
  return checks.filter((row) => row.metric === "opening-inflation");
}

describe("opening inflation diagnostic (#3317)", () => {
  const seeded = getInitialNationalBudgetsForPreset("1991-default");

  it("passes every seeded 1991 opening", async () => {
    const checks = await inflationChecks(seeded);
    expect(checks).toHaveLength(23);
    expect(checks.filter((row) => row.severity !== "ok")).toEqual([]);
  });

  it("flags a historical hyperinflation opening and a snapped one", async () => {
    const br = seeded.find((b) => b.countryId === "BR")!;
    const historical = {
      ...br,
      economicFactors: { ...br.economicFactors, inflationRate: 480, wageGrowth: 50 },
    };
    const snapped = {
      ...br,
      countryId: "BR",
      economicFactors: { ...br.economicFactors, inflationRate: 100 },
    };
    for (const budget of [historical, snapped]) {
      const [row] = await inflationChecks([budget]);
      expect(row?.severity).toBe("critical");
      expect(row?.id).toBe("opening.BR.opening-inflation");
    }
  });
});
