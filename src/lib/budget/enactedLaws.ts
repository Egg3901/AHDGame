import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { EnactedLaw } from "@/lib/db/types/budget";
import type { Bill, LegislationPolicyOption, LegislationType } from "@/lib/db/types/legislation";
import type { CountryId } from "@/lib/constants/countries";

const COUNTRY_SCOPE_TO_ID: Record<string, CountryId> = {
  us: "US",
  uk: "UK",
  jp: "JP",
  de: "DE",
};

export async function recordEnactedLaw(
  db: Db,
  bill: Bill,
  legislationType: LegislationType,
  fiscalYear: number,
  scope: "national" | "state",
  stateId?: string,
  policyOption?: LegislationPolicyOption,
  /**
   * Political-legislation v2 (spec §5.1): the option's annual revenue at the
   * enacting scope, computed by the caller through the new cost engine. Stored
   * as annualRevenueV2 and summed from scratch into revenue.lawRevenue.
   */
  annualRevenueV2?: number,
  /** #3598: attribution tag. Omitted/undefined means an ordinary legislative bill. */
  source?: EnactedLaw["source"]
): Promise<EnactedLaw> {
  // Each legislation type represents one active fiscal posture at a time.
  // Repeal prior unrepealed records before inserting the replacement law.
  const repealQuery: Record<string, unknown> = {
    scope,
    legislationTypeId: legislationType._id,
    repealedAt: { $exists: false },
  };
  if (stateId) {
    repealQuery.stateId = stateId;
  } else {
    repealQuery.$or = [{ stateId: { $exists: false } }, { stateId: null }];
  }

  await db
    .collection<EnactedLaw>("enactedLaws")
    .updateMany(repealQuery, { $set: { repealedAt: new Date() } });

  const enactedLaw: EnactedLaw = {
    _id: new ObjectId(),
    billId: bill._id,
    legislationTypeId: legislationType._id,
    title: bill.title,
    scope,
    countryId: (bill.countryId ??
      COUNTRY_SCOPE_TO_ID[legislationType.countryScope ?? "us"] ??
      "US") as CountryId,
    stateId,
    budgetCost: legislationType.budgetCost || 0,
    ...(policyOption?.gdpPerCapitaMultiplier !== undefined && {
      gdpPerCapitaMultiplier: policyOption.gdpPerCapitaMultiplier,
    }),
    ...(policyOption?.annualCostPerCapita !== undefined && {
      annualCostPerCapita: policyOption.annualCostPerCapita,
    }),
    ...(policyOption?.gdpCostFraction !== undefined && {
      gdpCostFraction: policyOption.gdpCostFraction,
    }),
    ...(policyOption?.incomeCostFraction !== undefined && {
      incomeCostFraction: policyOption.incomeCostFraction,
    }),
    ...(policyOption?.rate !== undefined && { rate: policyOption.rate }),
    // §5.1: new-generation records carry the nested model (never the legacy
    // flat fields — those spreads above are undefined for v2 options).
    ...(policyOption?.costModelV2 !== undefined && { costModelV2: policyOption.costModelV2 }),
    ...(annualRevenueV2 !== undefined && annualRevenueV2 > 0 && { annualRevenueV2 }),
    ...(policyOption
      ? {
          policyOptionIndex: legislationType.policyOptions?.findIndex(
            (o) => o.id === policyOption.id
          ),
        }
      : {}),
    budgetCategory: legislationType.budgetCategory || legislationType.policyDomain,
    ...(legislationType.isGrant ? { isGrant: true } : {}),
    enactedAt: new Date(),
    enactedYear: fiscalYear,
    ...(source !== undefined && { source }),
  };

  await db.collection<EnactedLaw>("enactedLaws").insertOne(enactedLaw);
  return enactedLaw;
}
