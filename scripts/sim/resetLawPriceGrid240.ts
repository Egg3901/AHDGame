/**
 * Non-selectable fiscal sensitivity for the complete proposed national grid.
 * A simulated review object exercises enactment arithmetic, not legal approval.
 */
import { resetLawFamilies, type LegislativePosition } from "../../src/lib/resetLegislation/catalog";
import { openingLawReference } from "../../src/lib/resetLegislation/openingLaw";
import type { ResetCountry } from "../../src/lib/resetLegislation/fundingOwner";
import profiles from "../../src/lib/resetLegislation/provisionalBalanceProfiles.json";
import { enactReviewedLawOption } from "../../src/lib/resetLegislation/rules/enactment";
import { provisionalPriceVector } from "../../src/lib/resetLegislation/rules/provisionalPricing";
import type { ReviewedLawOption } from "../../src/lib/resetLegislation/rules/reviewedOption";
import { OPENING, runResetTreasury240 } from "./resetTreasury240";

export interface ResetLawPriceRun {
  country: ResetCountry;
  familyId: string;
  choice: LegislativePosition;
  anchor: "source-book" | "new-program-gdp-proxy";
  previousAnnualAllocation: number;
  proposedAnnualAllocation: number;
  annualLawDelta: number;
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

/** Each run changes one family, leaving the other 50 national families at 1991. */
export function runResetLawPriceGrid240(): ResetLawPriceRun[] {
  const profileByFamily = new Map(profiles.map((profile) => [profile.familyId, profile]));
  const runs: ResetLawPriceRun[] = [];
  for (const country of ["US", "UK", "JP"] as const) {
    for (const family of resetLawFamilies) {
      if (!family.availability.national.includes(country)) continue;
      const reference = openingLawReference(country, "national", family.id);
      const profile = profileByFamily.get(family.id);
      if (!reference || !profile || profile.status !== "provisional-design-only") {
        throw new Error(`Missing provisional law inputs for ${country}:${family.id}`);
      }
      const ownedSources = reference.sourceComponents.filter(
        (component) =>
          component.historicalDisposition === "retained-legal-lineage" &&
          component.fiscalRole === "single-booked-owner" &&
          component.fiscalOwner === family.id &&
          component.replacementRestriction !== "protected-transfer"
      );
      const sourceAnnual = ownedSources.reduce((sum, source) => sum + source.annualBooked, 0);
      const prices = provisionalPriceVector({
        gdp: OPENING[country].gdp,
        sourceAnnual,
        profile,
      });
      for (const [index, choice] of positions.entries()) {
        const option: ReviewedLawOption = {
          familyId: family.id,
          country,
          scope: "national",
          choice,
          effectiveFromYear: 1991,
          legalAuthorityId: `sim:${family.id}`,
          fundingAccountId: `sim:${family.ownerCode}`,
          serviceDelivererId: `sim:${family.id}`,
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
        const treasury = runResetTreasury240(
          country,
          "unchanged",
          transition.annualAllocationDelta
        );
        runs.push({
          country,
          familyId: family.id,
          choice,
          anchor: prices.anchor,
          previousAnnualAllocation: transition.previousAnnualAllocation,
          proposedAnnualAllocation: transition.nextAnnualAllocation,
          annualLawDelta: transition.annualAllocationDelta,
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

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/resetLawPriceGrid240.ts")) {
  const runs = runResetLawPriceGrid240();
  const byCountry = (["US", "UK", "JP"] as const).map((country) => {
    const rows = runs.filter((run) => run.country === country);
    const highest = (measure: (row: ResetLawPriceRun) => number) =>
      [...rows].sort((a, b) => measure(b) - measure(a))[0]!;
    const earliest = [...rows]
      .filter((row) => row.firstDebtCeilingCrossing !== null)
      .sort((a, b) => a.firstDebtCeilingCrossing! - b.firstDebtCeilingCrossing!)[0];
    return {
      country,
      runs: rows.length,
      allFarLeftAnnualAllocationsToGdp:
        rows
          .filter((row) => row.choice === "far_left")
          .reduce((sum, row) => sum + row.proposedAnnualAllocation, 0) / OPENING[country].gdp,
      earliestCrossing: earliest
        ? {
            familyId: earliest.familyId,
            choice: earliest.choice,
            turn: earliest.firstDebtCeilingCrossing,
          }
        : null,
      crossingWithinFirstYear: rows
        .filter(
          (row) => row.firstDebtCeilingCrossing !== null && row.firstDebtCeilingCrossing <= 48
        )
        .map((row) => ({
          familyId: row.familyId,
          choice: row.choice,
          turn: row.firstDebtCeilingCrossing,
        })),
      largestAnnualIncrease: highest((row) => row.annualLawDelta),
      worstDebt: highest((row) => row.finalDebt),
      maximumArrears: highest((row) => row.peakNationalArrears),
    };
  });
  console.log(
    JSON.stringify(
      { method: "one-family-at-a-time provisional fiscal sensitivity", byCountry },
      null,
      2
    )
  );
}
