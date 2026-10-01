/**
 * Combined national-law fiscal stress. Simulated review records exercise the
 * portable bill and treasury rules; they do not approve playable law options.
 */
import { resetLawFamilies, type LegislativePosition } from "../../src/lib/resetLegislation/catalog";
import { fundingSeatForLaw, type ResetCountry } from "../../src/lib/resetLegislation/fundingOwner";
import { openingLawReference } from "../../src/lib/resetLegislation/openingLaw";
import profiles from "../../src/lib/resetLegislation/provisionalBalanceProfiles.json";
import { enactReviewedBill } from "../../src/lib/resetLegislation/rules/billEnactment";
import { provisionalPriceVector } from "../../src/lib/resetLegislation/rules/provisionalPricing";
import type { ReviewedLawOption } from "../../src/lib/resetLegislation/rules/reviewedOption";
import { OPENING, runResetTreasury240 } from "./resetTreasury240";

export type ResetLawPortfolio = "all_far_left" | "all_center" | "all_far_right" | "alternating";

export interface ResetLawPortfolioRun {
  country: ResetCountry;
  portfolio: ResetLawPortfolio;
  rollout: "immediate" | "staged";
  provisions: number;
  previousAnnualAllocation: number;
  proposedAnnualAllocation: number;
  annualLawDelta: number;
  accountDeltaResidual: number;
  finalDebt: number;
  peakNationalArrears: number;
  firstDebtCeilingCrossing: number | null;
  maximumAccountingResidual: number;
}

const positions: readonly LegislativePosition[] = [
  "far_left",
  "center_left",
  "center",
  "center_right",
  "far_right",
];

const portfolios: readonly ResetLawPortfolio[] = [
  "all_far_left",
  "all_center",
  "all_far_right",
  "alternating",
];

function positionFor(portfolio: ResetLawPortfolio, index: number): LegislativePosition {
  if (portfolio === "all_far_left") return "far_left";
  if (portfolio === "all_far_right") return "far_right";
  if (portfolio === "all_center") return "center";
  return index % 2 === 0 ? "center_left" : "center_right";
}

/** All eligible national families switch in one bill at turn 2. */
export function runResetLawPortfolios240(): ResetLawPortfolioRun[] {
  const profilesByFamily = new Map(profiles.map((profile) => [profile.familyId, profile]));
  const runs: ResetLawPortfolioRun[] = [];
  for (const country of ["US", "UK", "JP"] as const) {
    const eligibleFamilies = resetLawFamilies.filter((family) =>
      family.availability.national.includes(country)
    );
    for (const portfolio of portfolios) {
      const provisions = eligibleFamilies.map((family, index) => {
        const reference = openingLawReference(country, "national", family.id);
        const profile = profilesByFamily.get(family.id);
        if (!reference || !profile || profile.status !== "provisional-design-only") {
          throw new Error(`Missing ${country}:${family.id} national stress inputs`);
        }
        const ownedSources = reference.sourceComponents.filter(
          (source) =>
            source.historicalDisposition === "retained-legal-lineage" &&
            source.fiscalRole === "single-booked-owner" &&
            source.fiscalOwner === family.id &&
            source.replacementRestriction !== "protected-transfer"
        );
        const sourceAnnual = ownedSources.reduce((sum, source) => sum + source.annualBooked, 0);
        const pricing = provisionalPriceVector({
          gdp: OPENING[country].gdp,
          sourceAnnual,
          profile,
        });
        const choice = positionFor(portfolio, index);
        const owner = fundingSeatForLaw(family, country);
        const option: ReviewedLawOption = {
          familyId: family.id,
          country,
          scope: "national",
          choice,
          effectiveFromYear: 1991,
          legalAuthorityId: `sim:${country}:${family.id}`,
          fundingAccountId: `sim:${country}:${owner}`,
          serviceDelivererId: `sim:${country}:${family.id}`,
          annualAllocation: pricing.fiveAnnualAllocations[positions.indexOf(choice)]!,
          accruedTransitionLiability: 0,
          supersedesSourceIds: ownedSources.map((source) => source.sourceId),
          review: { legal: "approved", fiscal: "approved", outcome: "approved" },
        };
        return {
          family,
          reference,
          option,
          openingChoice: null,
          openingFundingAccountId: option.fundingAccountId,
        };
      });
      const bill = enactReviewedBill({
        provisions,
        existingPrograms: [],
        year: 1991,
        turn: 2,
      });
      const accountDelta = bill.fundingAccountDeltas.reduce((sum, row) => sum + row.annualDelta, 0);
      for (const rollout of ["immediate", "staged"] as const) {
        // The staged stress adopts roughly one fifth of the bundle at the
        // start of each year. Final authority is identical to the immediate
        // case, but five-year borrowing and arrears should differ.
        const treasury = runResetTreasury240(
          country,
          "unchanged",
          rollout === "immediate"
            ? bill.annualAllocationDelta
            : (turn) =>
                bill.transitions
                  .slice(
                    0,
                    Math.ceil((bill.transitions.length * Math.min(5, Math.ceil(turn / 48))) / 5)
                  )
                  .reduce((sum, row) => sum + row.annualAllocationDelta, 0)
        );
        runs.push({
          country,
          portfolio,
          rollout,
          provisions: bill.transitions.length,
          previousAnnualAllocation: bill.transitions.reduce(
            (sum, row) => sum + row.previousAnnualAllocation,
            0
          ),
          proposedAnnualAllocation: bill.transitions.reduce(
            (sum, row) => sum + row.nextAnnualAllocation,
            0
          ),
          annualLawDelta: bill.annualAllocationDelta,
          accountDeltaResidual: accountDelta - bill.annualAllocationDelta,
          finalDebt: treasury.finalDebt,
          peakNationalArrears: treasury.peakNationalArrears,
          firstDebtCeilingCrossing: treasury.firstDebtCeilingCrossing,
          maximumAccountingResidual: treasury.maximumAccountingResidual,
        });
      }
    }
  }
  return runs;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/resetLawPortfolios240.ts")) {
  console.log(
    JSON.stringify(
      {
        method: "simultaneous all-family provisional bill stress, not a playable balance forecast",
        runs: runResetLawPortfolios240(),
      },
      null,
      2
    )
  );
}
