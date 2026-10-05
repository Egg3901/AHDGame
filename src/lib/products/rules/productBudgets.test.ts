import { describe, expect, it } from "vitest";
import {
  allocateProductDevelopmentBudget,
  allocateProductAdvertisingBudget,
} from "./productBudgets";

describe("shared product budgets", () => {
  it("funds concurrent development without letting a launched manufacturing project block media", () => {
    const projects = [
      { id: "plant", stage: "launch", paidAnchor: 100, thresholdAnchor: 100 },
      { id: "title", stage: "development", paidAnchor: 20, thresholdAnchor: 100 },
    ];
    expect(allocateProductDevelopmentBudget({ budgetAnchor: 100, projects })).toEqual({
      byProjectId: { plant: 0, title: 80 },
      genericResearchAnchor: 20,
    });
    projects[0].stage = "development";
    projects[0].paidAnchor = 20;
    expect(allocateProductDevelopmentBudget({ budgetAnchor: 100, projects })).toEqual({
      byProjectId: { plant: 50, title: 50 },
      genericResearchAnchor: 0,
    });
  });
  it("keeps delivered marketing conserved when both products claim the whole budget", () => {
    expect(
      allocateProductAdvertisingBudget({
        deliveredBudgetAnchor: 90,
        projects: [
          { id: "plant", share: 1 },
          { id: "title", share: 1 },
        ],
      })
    ).toEqual({ plant: 45, title: 45 });
    expect(
      allocateProductAdvertisingBudget({
        deliveredBudgetAnchor: 90,
        projects: [
          { id: "plant", share: 0.25 },
          { id: "title", share: 0.25 },
        ],
      })
    ).toEqual({ plant: 22.5, title: 22.5 });
    expect(
      allocateProductAdvertisingBudget({
        deliveredBudgetAnchor: 0,
        projects: [{ id: "plant", share: 1 }],
      })
    ).toEqual({ plant: 0 });
  });
});
