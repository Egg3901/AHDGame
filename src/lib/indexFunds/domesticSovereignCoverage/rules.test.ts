import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";
import {
  buildDomesticSovereignBondFundSeed,
  domesticSovereignBondFundSlug,
  planDomesticSovereignCoverage,
  type DomesticCoveragePlanInput,
} from "./rules";
import { isGlobalFundBondEligible } from "@/lib/indexFunds/fundBondReserve";
import { sovereignBondRemainingCapacityUnits } from "@/lib/bonds/holderCap";
import {
  INDEX_FUND_INITIAL_NAV,
  INDEX_FUND_SEED_CASH_ANCHOR,
  INDEX_FUND_SEED_RESERVE_UNITS,
  calculateBackingRatio,
} from "@/lib/indexFunds/unitAccounting";
import { computeFundAllocationBreakdown } from "@/lib/indexFunds/fundAllocation";
import { BOND_FUND_DEFINITIONS } from "@/lib/indexFunds/fundDefinitions";

function input(overrides: Partial<DomesticCoveragePlanInput> = {}): DomesticCoveragePlanInput {
  return {
    enabled: true,
    registeredCountryIds: ["US", "FR"],
    budgetedCountryIds: ["US", "FR"],
    liveSovereignIssuerCountryIds: ["US", "FR"],
    coveredHomeCountryIds: ["US"],
    anchorCurrencyByCountryId: { US: "USD", FR: "FRF" },
    ...overrides,
  };
}

function coverageBond(partial: Partial<Bond>): Bond {
  return {
    issuerType: "sovereign",
    faceValue: 1000,
    totalIssued: 1_000_000,
    holders: [],
    ...partial,
  } as unknown as Bond;
}

describe("domestic sovereign coverage rules (#1001)", () => {
  it("plans nothing when the gate is off, so omitted behavior is equivalent", () => {
    expect(planDomesticSovereignCoverage(input({ enabled: false }))).toEqual([]);
  });

  it("covers the uncovered issuer only, sorted deterministically", () => {
    expect(planDomesticSovereignCoverage(input())).toEqual(["FR"]);
    expect(
      planDomesticSovereignCoverage(
        input({
          registeredCountryIds: ["FR", "DE", "US"],
          budgetedCountryIds: ["US", "FR", "DE"],
          liveSovereignIssuerCountryIds: ["US", "FR", "DE"],
          coveredHomeCountryIds: ["US"],
          anchorCurrencyByCountryId: { US: "USD", FR: "FRF", DE: "DEM" },
        })
      )
    ).toEqual(["DE", "FR"]);
  });

  it("skips countries with no budget, no live issue, no currency, or no registration", () => {
    // No national budget: rating eligibility has nothing to read.
    expect(planDomesticSovereignCoverage(input({ budgetedCountryIds: ["US"] }))).toEqual([]);
    // No live sovereign issue: no demand, nothing to cover.
    expect(planDomesticSovereignCoverage(input({ liveSovereignIssuerCountryIds: ["US"] }))).toEqual(
      []
    );
    // No anchor currency: a fund cannot be denominated.
    expect(
      planDomesticSovereignCoverage(input({ anchorCurrencyByCountryId: { US: "USD" } }))
    ).toEqual([]);
    // Dissolved/unregistered states never gain coverage.
    expect(planDomesticSovereignCoverage(input({ registeredCountryIds: ["US"] }))).toEqual([]);
    // Already covered issuers are never duplicated.
    expect(planDomesticSovereignCoverage(input({ coveredHomeCountryIds: ["US", "FR"] }))).toEqual(
      []
    );
  });

  it("seeds a domestic-only mandate matching the standing country bond funds", () => {
    const seed = buildDomesticSovereignBondFundSeed("FR", "FRF");
    expect(seed).toMatchObject({
      slug: "fr_sovereign_bonds",
      scope: "country",
      kind: "bond",
      countryId: "FR",
      anchorCurrencyCode: "FRF",
      bondUniverse: { issuerType: "sovereign", homeOnly: true },
    });
    // Slug convention converges with the seeded country funds: an already
    // seeded country can never be double-covered under a second identity.
    const standing = BOND_FUND_DEFINITIONS.find((def) => def.countryId === "US");
    expect(standing?.bondUniverse).toMatchObject({ issuerType: "sovereign", homeOnly: true });
    expect(domesticSovereignBondFundSlug("US")).toBe(standing?.slug);
  });

  it("keeps home paper eligible behind capital controls", () => {
    // Controls exclude foreign funds; the domestic fund always clears them,
    // mirroring isGlobalFundBondEligible. Coverage therefore reaches
    // controlled currencies without weakening the control for outsiders.
    const home = { countryId: "FR", currencyCode: "FRF" } as Bond;
    expect(isGlobalFundBondEligible(home, "FR", new Set(["FRF"]), new Set(["FRF"]))).toBe(true);
    expect(isGlobalFundBondEligible(home, "US", new Set(["FRF"]), new Set(["FRF"]))).toBe(false);
  });

  it("holds every new fund under the per-issue position limit", () => {
    const fundId = new ObjectId();
    const fresh = coverageBond({});
    // 1M face / 1k face = 1000 units; 25% cap = 250 units for a new holder.
    expect(sovereignBondRemainingCapacityUnits(fresh, "fundId", fundId)).toBe(250);
    const capped = coverageBond({ holders: [{ fundId, units: 250 } as never] });
    expect(sovereignBondRemainingCapacityUnits(capped, "fundId", fundId)).toBe(0);
  });

  it("seeds fully backed funds whose deployable cash keeps the 5% buffer", () => {
    const backing = calculateBackingRatio({
      cashAnchor: INDEX_FUND_SEED_CASH_ANCHOR,
      holdingsValueAnchor: 0,
      bondPrincipalAnchor: 0,
      openOrdersEscrowAnchor: 0,
      queuedRedemptionUnits: 0,
      quotedNav: INDEX_FUND_INITIAL_NAV,
      unitSupply: INDEX_FUND_SEED_RESERVE_UNITS,
    });
    // 50M cash against 100 x 500k quoted liability: exactly fully backed.
    expect(backing.backingRatio).toBe(1);
    expect(backing.shouldAutoPause).toBe(false);
    const breakdown = computeFundAllocationBreakdown(
      {
        cashAnchor: INDEX_FUND_SEED_CASH_ANCHOR,
        holdings: [],
        bondAllocations: [],
        kind: "bond",
      },
      { bondPrincipalAnchor: 0 }
    );
    // The deployable budget stops 5% of backing short of cash: the buffer is
    // never spent into bonds, whatever the reserve target says.
    expect(breakdown.totalBackingAnchor).toBe(INDEX_FUND_SEED_CASH_ANCHOR);
    expect(breakdown.cashAvailableForBondDeployAnchor).toBe(
      INDEX_FUND_SEED_CASH_ANCHOR - 0.05 * INDEX_FUND_SEED_CASH_ANCHOR
    );
  });
});
