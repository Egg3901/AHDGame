import { describe, it, expect } from "vitest";
import {
  countProvisionsChargedNationalInfluence,
  getProvisionCostTotal,
  BILL_CATEGORIES,
  NATIONALIZATION_BILL_CATEGORIES,
  STATE_BILL_CATEGORIES,
  CATEGORY_TO_POLICY_DOMAINS,
  categoryHasProposableContent,
  getProposableBillCategories,
} from "@shared/constants/legislation";

describe("proposable bill categories", () => {
  // UK-shaped legislation types: no agriculture/technology laws.
  const ukTypes = [
    { policyDomain: "healthcare" },
    { policyDomain: "tax" },
    { policyDomain: "governance" },
    { policyDomain: "defense" },
  ];
  // CN-shaped: has agriculture + technology laws.
  const cnTypes = [
    { policyDomain: "healthcare" },
    { policyDomain: "agriculture" },
    { policyDomain: "technology" },
    { policyDomain: "defense" },
  ];

  it("hides agriculture/technology when the country has no such laws (UK/US)", () => {
    expect(categoryHasProposableContent("agriculture", ukTypes)).toBe(false);
    expect(categoryHasProposableContent("technology", ukTypes)).toBe(false);
    const cats = getProposableBillCategories(ukTypes);
    expect(cats).not.toContain("agriculture");
    expect(cats).not.toContain("technology");
  });

  it("keeps agriculture/technology when the country has those laws (JP/DE/CN)", () => {
    expect(categoryHasProposableContent("agriculture", cnTypes)).toBe(true);
    expect(categoryHasProposableContent("technology", cnTypes)).toBe(true);
    const cats = getProposableBillCategories(cnTypes);
    expect(cats).toContain("agriculture");
    expect(cats).toContain("technology");
  });

  it("always keeps trade (tariff) and industry (subsidy) categories — they use their own builders", () => {
    expect(categoryHasProposableContent("trade", ukTypes)).toBe(true);
    expect(categoryHasProposableContent("industry", ukTypes)).toBe(true);
    expect(categoryHasProposableContent("trade", [])).toBe(true);
    expect(categoryHasProposableContent("industry", [])).toBe(true);
  });

  it("returns all categories while legislation types are still loading (empty input)", () => {
    expect(getProposableBillCategories([])).toContain("agriculture");
    expect(getProposableBillCategories([])).toContain("technology");
  });

  it("maps multi-domain categories (e.g. economy) via any matching domain", () => {
    expect(categoryHasProposableContent("economy", [{ policyDomain: "labor" }])).toBe(true);
    expect(categoryHasProposableContent("economy", [{ policyDomain: "healthcare" }])).toBe(false);
  });
});

describe("legislation bill costs", () => {
  it("counts policy and subsidy rows together for NPI ladder", () => {
    expect(
      getProvisionCostTotal(
        countProvisionsChargedNationalInfluence({
          policyProvisionCount: 0,
          subsidyProvisionCount: 2,
        })
      )
    ).toBe(15); // 2 provisions: 5 + 10 = 15
  });

  it("sums policy + subsidy counts", () => {
    expect(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: 2,
        subsidyProvisionCount: 1,
      })
    ).toBe(3);
  });

  it("v3 Phase 7b regression: a union-law-only bill costs NPI just like a single subsidy provision (was previously free)", () => {
    const unionLawOnly = getProvisionCostTotal(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: 0,
        subsidyProvisionCount: 0,
        unionLawProvisionCount: 1,
      })
    );
    const subsidyOnly = getProvisionCostTotal(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: 0,
        subsidyProvisionCount: 1,
      })
    );
    expect(unionLawOnly).toBe(subsidyOnly);
    expect(unionLawOnly).toBeGreaterThan(0);
  });

  it("omitting unionLawProvisionCount is equivalent to 0 (backward compatible)", () => {
    expect(
      countProvisionsChargedNationalInfluence({ policyProvisionCount: 1, subsidyProvisionCount: 0 })
    ).toBe(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: 1,
        subsidyProvisionCount: 0,
        unionLawProvisionCount: 0,
      })
    );
  });

  it("sums policy + subsidy + union-law counts together", () => {
    expect(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: 1,
        subsidyProvisionCount: 1,
        unionLawProvisionCount: 1,
      })
    ).toBe(3);
  });
});

describe("state ownership bill category", () => {
  it("is a national bill category", () => {
    expect(BILL_CATEGORIES).toContain("state ownership");
    expect(NATIONALIZATION_BILL_CATEGORIES.has("state ownership")).toBe(true);
  });
  it("is national-only and carries no policy domains", () => {
    expect((STATE_BILL_CATEGORIES as readonly string[]).includes("state ownership")).toBe(false);
    expect(CATEGORY_TO_POLICY_DOMAINS["state ownership"]).toBeUndefined();
  });
});

describe("custom bill category", () => {
  it("is a national and state category", () => {
    expect(BILL_CATEGORIES).toContain("custom");
    expect(STATE_BILL_CATEGORIES).toContain("custom");
  });

  it("is always proposable regardless of a country's legislation types", () => {
    expect(categoryHasProposableContent("custom", [])).toBe(true);
    expect(categoryHasProposableContent("custom", [{ policyDomain: "economic" }])).toBe(true);
    // With at least one legislation type loaded, custom must still be offered.
    expect(getProposableBillCategories([{ policyDomain: "economic" }])).toContain("custom");
  });
});
