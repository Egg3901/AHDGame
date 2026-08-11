import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Subsidy, SubsidyProvision, EndSubsidyProvision } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { fireSubsidyCreatedPulse, fireSubsidyEndedPulse } from "@/lib/corporations/sentimentEvents";

/** Fixed margin bonus applied per qualifying subsidy (percentage points). */
export const SUBSIDY_MARGIN_BONUS = 7.5;

/**
 * Check whether a corporation sector qualifies for a given subsidy.
 *
 * Qualification rules:
 * - scopeType "economy_wide": all sectors qualify (subject to domestic-only filter)
 * - scopeType "sector": sectorType must match targetSectorType
 * - targetStrategyId: if set, sector.strategyId (default "standard") must match
 * - domesticOnly national: corp HQ country must match subsidy countryId
 * - domesticOnly state: corp HQ state must match subsidy stateId
 */
export function corpQualifiesForSubsidy(
  subsidy: Subsidy,
  corpHqState: string,
  sectorType: CorporationType,
  sectorStateId: string,
  sectorStrategyId: string | undefined,
  sectorCountryId?: CountryId,
  corpCountryId?: CountryId
): boolean {
  // Scope filter: only apply subsidies in the right territory
  if (subsidy.scope === "state") {
    // State subsidies only apply to sectors operating IN that state
    if (sectorStateId !== subsidy.stateId) return false;
  } else {
    // National subsidies only apply to sectors in the subsidy's country
    if (sectorCountryId !== subsidy.countryId) return false;
  }

  // Sector type filter
  if (subsidy.scopeType === "sector" && subsidy.targetSectorType !== sectorType) return false;

  // Strategy filter — default to "standard" when no strategyId set
  if (subsidy.targetStrategyId != null) {
    const effectiveStrategy = sectorStrategyId ?? "standard";
    if (effectiveStrategy !== subsidy.targetStrategyId) return false;
  }

  // Domestic-only filter
  if (subsidy.domesticOnly) {
    if (subsidy.scope === "state") {
      // State subsidy domestic = corp HQ'd in the same state
      if (corpHqState !== subsidy.stateId) return false;
    } else {
      // National subsidy domestic = corp HQ'd in the same country
      if (corpCountryId !== subsidy.countryId) return false;
    }
  }

  return true;
}

/**
 * Compute the total subsidy margin modifier (in percentage points) for a sector.
 * Federal and state subsidies stack: two qualifying subsidies = +15pp.
 */
export function getSubsidyMarginModifier(
  subsidies: Subsidy[],
  corpHqState: string,
  sectorType: CorporationType,
  sectorStateId: string,
  sectorStrategyId: string | undefined,
  sectorCountryId?: CountryId,
  corpCountryId?: CountryId
): number {
  let total = 0;
  for (const s of subsidies) {
    if (!s.active) continue;
    if (
      corpQualifiesForSubsidy(
        s,
        corpHqState,
        sectorType,
        sectorStateId,
        sectorStrategyId,
        sectorCountryId,
        corpCountryId
      )
    ) {
      total += SUBSIDY_MARGIN_BONUS;
    }
  }
  return total;
}

/**
 * Upsert a subsidy document when an industry bill provision is enacted.
 * Uses a composite key so re-enacting the same scope replaces rather than duplicates.
 */
export async function applySubsidyProvision(
  db: Db,
  countryId: CountryId,
  scope: "national" | "state",
  stateId: string | undefined,
  provision: SubsidyProvision,
  sourceBillId: ObjectId
): Promise<void> {
  const now = new Date();
  const filter: Record<string, unknown> = {
    countryId,
    scope,
    stateId: stateId ?? null,
    scopeType: provision.scopeType,
    targetSectorType: provision.targetSectorType ?? null,
    targetStrategyId: provision.targetStrategyId ?? null,
  };

  await db.collection<Subsidy>("subsidies").updateOne(
    filter,
    {
      $set: { domesticOnly: provision.domesticOnly, active: true, sourceBillId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  if (provision.scopeType === "sector" && provision.targetSectorType) {
    await fireSubsidyCreatedPulse(db, provision.targetSectorType, countryId);
  }
}

/**
 * Remove (deactivate) a subsidy when an end_subsidy provision is enacted.
 * Marks active=false rather than deleting, preserving the audit trail.
 */
export async function applyEndSubsidyProvision(
  db: Db,
  countryId: CountryId,
  scope: "national" | "state",
  stateId: string | undefined,
  provision: EndSubsidyProvision
): Promise<void> {
  const filter: Record<string, unknown> = {
    countryId,
    scope,
    stateId: stateId ?? null,
    scopeType: provision.scopeType,
    targetSectorType: provision.targetSectorType ?? null,
    targetStrategyId: provision.targetStrategyId ?? null,
    active: true,
  };

  await db
    .collection<Subsidy>("subsidies")
    .updateMany(filter, { $set: { active: false, updatedAt: new Date() } });

  if (provision.scopeType === "sector" && provision.targetSectorType) {
    await fireSubsidyEndedPulse(db, provision.targetSectorType, countryId);
  }
}

/** Load all active subsidies for the current turn. */
export async function getActiveSubsidies(db: Db): Promise<Subsidy[]> {
  return db.collection<Subsidy>("subsidies").find({ active: true }).toArray();
}
