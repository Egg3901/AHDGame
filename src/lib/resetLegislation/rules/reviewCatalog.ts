/**
 * Portable authoring of playable reset-law options from the frozen 1991
 * source book and the calibrated five-position grid. The shell supplies the
 * jurisdiction GDP and actual funding account identity.
 */
import type { LawFamilyDefinition, LegislativePosition } from "../catalog";
import type { ResetCountry } from "../fundingOwner";
import type { OpeningLawReference } from "../openingLaw";
import type { ProvisionalPriceProfile } from "./provisionalPricing";
import { provisionalPriceVector } from "./provisionalPricing";
import type { LawChoice, LawScope } from "./eligibility";
import type { ReviewedLawOption } from "./reviewedOption";

const POSITIONS: readonly LegislativePosition[] = [
  "far_left",
  "center_left",
  "center",
  "center_right",
  "far_right",
];

export interface CalibratedBalanceProfile extends ProvisionalPriceProfile {
  familyId: string;
  status: string;
  primaryResponse: readonly number[];
  secondaryResponseFactors: readonly number[];
}

export interface ReviewedOptionCatalogEntry {
  option: ReviewedLawOption;
  title: string;
  description: string;
  currentChoice: LawChoice;
  currentAnnualAllocation: number;
  annualAllocationDelta: number;
  primaryMetricEffects: readonly {
    metricId: string;
    favorableNormalizedPoints: number;
  }[];
  balanceBasis: "game-calibrated-provisional";
}

/**
 * The old catalog is not an ideological source of truth. This conservative
 * bridge confines every 1991 starting point to one of the three middle rungs.
 */
export function openingChoice1991(reference: OpeningLawReference): LegislativePosition {
  const indices = reference.sourceComponents
    .map((component) => component.optionIndex)
    .filter((index) => Number.isInteger(index) && index >= 0);
  if (indices.length === 0 || reference.status === "no-dedicated-law") return "center";
  const mean = indices.reduce((sum, index) => sum + index, 0) / indices.length;
  if (mean <= 2) return "center_left";
  if (mean >= 5) return "center_right";
  return "center";
}

function replaceableOwnedSources(reference: OpeningLawReference): string[] {
  return reference.sourceComponents
    .filter(
      (source) =>
        source.historicalDisposition === "retained-legal-lineage" &&
        source.fiscalRole === "single-booked-owner" &&
        source.fiscalOwner === reference.familyId &&
        source.replacementRestriction !== "protected-transfer"
    )
    .map((source) => source.sourceId);
}

function sourceAnnual(reference: OpeningLawReference): number {
  const owned = new Set(replaceableOwnedSources(reference));
  return reference.sourceComponents.reduce(
    (sum, source) => sum + (owned.has(source.sourceId) ? source.annualBooked : 0),
    0
  );
}

export function buildReviewedOptionCatalog(input: {
  family: LawFamilyDefinition;
  reference: OpeningLawReference;
  profile: CalibratedBalanceProfile;
  country: ResetCountry;
  scope: LawScope;
  year: number;
  jurisdictionGdp: number;
  fundingAccountId: string;
  legalAuthorityId: string;
  serviceDelivererId: string;
  levelText?: Readonly<
    Partial<Record<LegislativePosition, { title: string; description: string }>>
  >;
}): ReviewedOptionCatalogEntry[] {
  const {
    family,
    reference,
    profile,
    country,
    scope,
    year,
    jurisdictionGdp,
    fundingAccountId,
    legalAuthorityId,
    serviceDelivererId,
  } = input;
  if (
    reference.key !== `${country}:${scope}:${family.id}` ||
    profile.familyId !== family.id ||
    profile.primaryResponse.length !== POSITIONS.length ||
    !Number.isInteger(year) ||
    year < 1991
  ) {
    throw new Error(`Invalid reviewed option catalog inputs for ${country}:${scope}:${family.id}`);
  }
  const currentChoice = openingChoice1991(reference);
  const prices = provisionalPriceVector({
    gdp: jurisdictionGdp,
    sourceAnnual: sourceAnnual(reference),
    profile,
  });
  const currentAnnualAllocation =
    prices.fiveAnnualAllocations[POSITIONS.indexOf(currentChoice)] ?? 0;
  const supersedesSourceIds = replaceableOwnedSources(reference);
  const entries = POSITIONS.map((choice, index): ReviewedOptionCatalogEntry => {
    const authored =
      input.levelText?.[choice] ?? family.levels.find((level) => level.position === choice);
    if (!authored) throw new Error(`Missing ${family.id}:${choice} option text`);
    const annualAllocation = prices.fiveAnnualAllocations[index]!;
    const response = profile.primaryResponse[index]!;
    if (!Number.isFinite(response)) throw new Error(`Missing ${family.id}:${choice} response`);
    return {
      option: {
        familyId: family.id,
        country,
        scope,
        choice,
        effectiveFromYear: 1991,
        legalAuthorityId,
        fundingAccountId,
        serviceDelivererId,
        annualAllocation,
        accruedTransitionLiability: 0,
        supersedesSourceIds,
        review: { legal: "approved", fiscal: "approved", outcome: "approved" },
      },
      title: authored.title,
      description: authored.description,
      currentChoice,
      currentAnnualAllocation,
      annualAllocationDelta: annualAllocation - currentAnnualAllocation,
      primaryMetricEffects: family.primaryMetricIds.map((metricId) => ({
        metricId,
        favorableNormalizedPoints: response,
      })),
      balanceBasis: "game-calibrated-provisional",
    };
  });
  if (country === "US" && scope === "national" && family.leaveToStates) {
    entries.push({
      option: {
        familyId: family.id,
        country,
        scope,
        choice: "leave_to_states",
        effectiveFromYear: 1991,
        legalAuthorityId,
        fundingAccountId,
        serviceDelivererId,
        annualAllocation: 0,
        accruedTransitionLiability: 0,
        supersedesSourceIds,
        review: { legal: "approved", fiscal: "approved", outcome: "approved" },
      },
      title: "Leave it to the States",
      description:
        "Wind down the eligible federal program after valid obligations. Existing state laws remain without automatic federal funding or outcomes.",
      currentChoice,
      currentAnnualAllocation,
      annualAllocationDelta: -currentAnnualAllocation,
      primaryMetricEffects: family.primaryMetricIds.map((metricId) => ({
        metricId,
        favorableNormalizedPoints: 0,
      })),
      balanceBasis: "game-calibrated-provisional",
    });
  }
  return entries;
}
