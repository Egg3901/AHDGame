import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { loadExecutionPolicies } from "./executionPolicy";

describe("current committee execution policy", () => {
  it("loads each anchor's own policy and gives persisted marketization precedence", async () => {
    const db = createInMemoryDb();
    db.seed("exchangeRates", [
      { _id: "us", countryId: "US", fxRegime: "peg", capitalControls: false },
      { _id: "uk", countryId: "UK", fxRegime: "band", capitalControls: true },
    ]);
    db.seed("federalBudget", [
      { _id: getNationalBudgetId("US"), economicFactors: { marketizationLevel: 0 } },
      { _id: getNationalBudgetId("UK"), economicFactors: { marketizationLevel: 100 } },
    ]);
    const policies = await loadExecutionPolicies(
      db as unknown as Db,
      ["US", "UK", "US"],
      1960,
      true
    );
    expect(policies.size).toBe(2);
    expect(policies.get("US")).toEqual({
      fxCommitment: { regime: "peg", capitalControls: false },
      commandEconomy: true,
    });
    expect(policies.get("UK")).toEqual({
      fxCommitment: { regime: "band", capitalControls: true },
      commandEconomy: false,
    });
    const disabled = await loadExecutionPolicies(db as unknown as Db, ["US"], 1960, false);
    expect(disabled.get("US")?.commandEconomy).toBe(false);
  });
});
