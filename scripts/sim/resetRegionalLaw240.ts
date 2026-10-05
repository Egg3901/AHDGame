/** One-law regional fiscal sensitivity. No regional Cabinet or automatic new grant. */
import { states1991 } from "../../src/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "../../src/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "../../src/lib/countries/jp/data/jpRegions1991";
import {
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "../../src/lib/seeds/reference/budgets";
import {
  resetLawFamilyById,
  type LegislativePosition,
} from "../../src/lib/resetLegislation/catalog";
import {
  regionalLawLevel,
  regionalLawLevels,
} from "../../src/lib/resetLegislation/regionalCatalog";
import { buildOpeningLawBoards1991 } from "../../src/lib/resetLegislation/openingBoards1991";
import { buildOpeningRegionalBoards1991 } from "../../src/lib/resetFinance/openingRegionalBoards1991";
import { enactReviewedLawOption } from "../../src/lib/resetLegislation/rules/enactment";
import { provisionalPriceVector } from "../../src/lib/resetLegislation/rules/provisionalPricing";
import type { ReviewedLawOption } from "../../src/lib/resetLegislation/rules/reviewedOption";
import {
  settleRegionalTreasury,
  type RegionalTreasuryState,
} from "../../src/lib/resetFinance/rules/settlement";
import profiles from "../../src/lib/resetLegislation/provisionalBalanceProfiles.json";
import { OPENING } from "./resetTreasury240";

const regions = { US: states1991, UK: ukRegions1991, JP: jpRegions1991 } as const;
const positions: readonly LegislativePosition[] = [
  "far_left",
  "center_left",
  "center",
  "center_right",
  "far_right",
];
export interface ResetRegionalLawRun {
  country: "US" | "UK" | "JP";
  regionId: string;
  familyId: string;
  choice: LegislativePosition;
  annualLawDelta: number;
  minimumDeliveryRatio: number;
  finalRegionalArrears: number;
  maximumAccountingResidual: number;
}

/** One locally authored family at a time, for every region and policy level. */
export function runResetRegionalLaw240(
  familyIds: readonly string[] = ["L19"]
): ResetRegionalLawRun[] {
  if (
    new Set(familyIds).size !== familyIds.length ||
    familyIds.some((id) => !regionalLawLevels.some((level) => level.familyId === id))
  ) {
    throw new Error("Invalid regional law sweep family selection");
  }
  const lawBoards = new Map(
    buildOpeningLawBoards1991("sim-world", 1).map((board) => [board._id, board])
  );
  const fiscalBoards = new Map(
    buildOpeningRegionalBoards1991("sim-world", 1).map((board) => [board._id, board])
  );
  const nationalBudgets = new Map(
    getInitialNationalBudgetsForPreset("1991-default").map((budget) => [budget.countryId, budget])
  );
  const runs: ResetRegionalLawRun[] = [];
  for (const country of ["US", "UK", "JP"] as const) {
    const regionalGdpUnits = regions[country].reduce((sum, region) => sum + region.gdp, 0);
    let assignedOwnRevenue = 0;
    let assignedGrants = 0;
    const budgetYear = nationalBudgets.get(country)!.fiscalYear;
    const budgets = new Map(
      generateStateBudgets(
        regions[country].map((region) => ({
          id: region._id,
          countryId: region.countryId,
          population: region.population,
          gdp: region.gdp,
        })),
        budgetYear
      ).map((budget) => [budget.stateId, budget])
    );
    for (const region of regions[country]) {
      const key = `${country}:${region._id}`;
      const fiscal = fiscalBoards.get(key);
      const budget = budgets.get(region._id);
      if (!fiscal || !budget) throw new Error(`Missing regional 1991 law inputs ${key}`);
      // Region seed GDP fields are relative input units, not currency amounts.
      // Apportion the national currency book before using a GDP-price proxy.
      const scopedGdp = (OPENING[country].gdp * region.gdp) / regionalGdpUnits;
      const ownRevenue = budget.revenue.total - budget.revenue.federalGrants;
      // The v2 reset attributes the national grant envelope to individual
      // regions by opening spending share. Reproduce that attribution here;
      // never count the v1 seed's separate grant proxy a second time.
      const grant =
        (OPENING[country].grants * fiscal.annualSpending) / OPENING[country].regionalSpending;
      assignedOwnRevenue += ownRevenue;
      assignedGrants += grant;
      for (const familyId of familyIds) {
        const family = resetLawFamilyById(familyId);
        if (family && !family.availability.regional.includes(country)) continue;
        const profile = profiles.find((row) => row.familyId === familyId);
        const reference = lawBoards.get(key)?.references[familyId];
        if (!family || !profile || !reference) {
          throw new Error(`Missing regional law family inputs ${key}:${familyId}`);
        }
        const ownedSources = reference.sourceComponents.filter(
          (component) =>
            component.historicalDisposition === "retained-legal-lineage" &&
            component.fiscalRole === "single-booked-owner" &&
            component.fiscalOwner === familyId &&
            component.replacementRestriction !== "protected-transfer"
        );
        const sourceAnnual = ownedSources.reduce((sum, source) => sum + source.annualBooked, 0);
        const prices = provisionalPriceVector({ gdp: scopedGdp, sourceAnnual, profile });
        for (const [index, choice] of positions.entries()) {
          if (!regionalLawLevel(country, familyId, choice))
            throw new Error(`Missing local ${familyId} level ${key}:${choice}`);
          const option: ReviewedLawOption = {
            familyId,
            country,
            scope: "regional",
            choice,
            effectiveFromYear: 1991,
            legalAuthorityId: `sim:${key}`,
            fundingAccountId: "regional_budget",
            serviceDelivererId: `sim:${key}`,
            annualAllocation: prices.fiveAnnualAllocations[index]!,
            accruedTransitionLiability: 0,
            supersedesSourceIds: ownedSources.map((source) => source.sourceId),
            review: { legal: "approved", fiscal: "approved", outcome: "approved" },
          };
          const transition = enactReviewedLawOption({
            family,
            reference,
            option,
            current: null,
            openingChoice: null,
            year: 1991,
            turn: 2,
          });
          const protectedClaims = fiscal.annualSpending * 0.5;
          const discretionaryClaims =
            fiscal.annualSpending * 0.5 + transition.annualAllocationDelta;
          if (discretionaryClaims < 0) throw new Error(`Negative regional claim ${key}:${choice}`);
          let state: RegionalTreasuryState = { cash: 0, arrears: 0 };
          let minimumDeliveryRatio = 1;
          let maximumAccountingResidual = 0;
          for (let turn = 1; turn <= 240; turn += 1) {
            const settled = settleRegionalTreasury(state, {
              ownRevenue: ownRevenue / 48,
              grantReceived: grant / 48,
              protectedClaims: protectedClaims / 48,
              discretionaryClaims: discretionaryClaims / 48,
            });
            state = settled.closing;
            minimumDeliveryRatio = Math.min(minimumDeliveryRatio, settled.deliveryRatio);
            maximumAccountingResidual = Math.max(
              maximumAccountingResidual,
              Math.abs(settled.accountingResidual)
            );
          }
          runs.push({
            country,
            regionId: region._id,
            familyId,
            choice,
            annualLawDelta: transition.annualAllocationDelta,
            minimumDeliveryRatio,
            finalRegionalArrears: state.arrears,
            maximumAccountingResidual,
          });
        }
      }
    }
    if (
      Math.abs(assignedOwnRevenue - OPENING[country].regionalOwnRevenue) > 0.01 ||
      Math.abs(assignedGrants - OPENING[country].grants) > 0.01
    ) {
      throw new Error(`${country} regional sensitivity did not reconcile own revenue and grants`);
    }
  }
  return runs;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/resetRegionalLaw240.ts")) {
  const familyIds = process.argv.includes("--authored")
    ? [...new Set(regionalLawLevels.map((level) => level.familyId))]
    : ["L19"];
  const runs = runResetRegionalLaw240(familyIds);
  const byCountry = (["US", "UK", "JP"] as const).map((country) => {
    const rows = runs.filter((row) => row.country === country);
    const worst = [...rows].sort((a, b) => a.minimumDeliveryRatio - b.minimumDeliveryRatio)[0]!;
    return {
      country,
      runs: rows.length,
      underfunded: rows.filter((row) => row.minimumDeliveryRatio < 0.9999).length,
      worst,
    };
  });
  console.log(
    JSON.stringify(
      {
        method: "one-region-one-family-option-at-a-time provisional sensitivity",
        familyIds,
        byCountry,
      },
      null,
      2
    )
  );
}
