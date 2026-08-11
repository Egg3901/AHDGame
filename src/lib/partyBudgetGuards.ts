import type { Collection, Db, Filter } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyBudget } from "@/lib/db/types";
import type { TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";

export interface PartyBudgetScopeRef {
  countryId: CountryId;
  partyId: string;
  scope: "national" | "state";
  stateId?: string;
}

type StoredPartyBudget = PartyBudget & { countryId?: CountryId };

type PartyBudgetMutableFields = Partial<
  Pick<
    PartyBudget,
    | "gotvBudgetPerTurn"
    | "gotvBudgetPercent"
    | "gotvTargetCategory"
    | "gotvTargetGroup"
    | "suppressionBudgetPercent"
    | "suppressionTargetCategory"
    | "suppressionTargetGroup"
    | "orgBuildingPercent"
    | "registrationBudgetPercent"
    | "transferReserveAmount"
    | "memberSupportReserveAmount"
    | "nppRecruitmentReserveAmount"
    | "treasuryPreset"
  >
>;

function buildLegacyPartyBudgetFilter(ref: PartyBudgetScopeRef): Filter<StoredPartyBudget> {
  return {
    ...buildPartyBudgetBaseFilter(ref),
    countryId: { $exists: false },
  };
}

function getPartyBudgetPersistedFields(
  budget: StoredPartyBudget | null | undefined,
  overrideFields: PartyBudgetMutableFields,
  countryId: CountryId,
  now: Date
) {
  return {
    gotvBudgetPerTurn: budget?.gotvBudgetPerTurn ?? 0,
    gotvBudgetPercent: budget?.gotvBudgetPercent ?? 0,
    gotvTargetCategory: budget?.gotvTargetCategory,
    gotvTargetGroup: budget?.gotvTargetGroup,
    suppressionBudgetPercent: budget?.suppressionBudgetPercent ?? 0,
    suppressionTargetCategory: budget?.suppressionTargetCategory,
    suppressionTargetGroup: budget?.suppressionTargetGroup,
    orgBuildingPercent: budget?.orgBuildingPercent ?? 0,
    registrationBudgetPercent: budget?.registrationBudgetPercent ?? 0,
    transferReserveAmount: budget?.transferReserveAmount ?? 0,
    memberSupportReserveAmount: budget?.memberSupportReserveAmount ?? 0,
    nppRecruitmentReserveAmount: budget?.nppRecruitmentReserveAmount ?? 0,
    treasuryPreset: budget?.treasuryPreset ?? ("custom" satisfies TreasuryPresetId),
    ...overrideFields,
    countryId,
    updatedAt: now,
  };
}

function buildPartyBudgetBaseFilter(ref: PartyBudgetScopeRef) {
  return ref.scope === "state"
    ? {
        partyId: ref.partyId,
        scope: "state" as const,
        stateId: ref.stateId,
      }
    : {
        partyId: ref.partyId,
        scope: "national" as const,
      };
}

function buildStrictPartyBudgetFilter(ref: PartyBudgetScopeRef): Filter<StoredPartyBudget> {
  return {
    ...buildPartyBudgetBaseFilter(ref),
    countryId: ref.countryId,
  };
}

function buildCompatiblePartyBudgetFilter(ref: PartyBudgetScopeRef): Filter<StoredPartyBudget> {
  return {
    ...buildPartyBudgetBaseFilter(ref),
    $or: [{ countryId: ref.countryId }, { countryId: { $exists: false } }],
  };
}

function buildPartyBudgetInsertDefaults(ref: PartyBudgetScopeRef, now: Date) {
  // Only include fields NOT already covered by the $set operator (via
  // getPartyBudgetPersistedFields). MongoDB throws MongoServerError when the
  // same path appears in both $set and $setOnInsert in the same update document.
  // countryId / budget numeric fields live in $set; only identity + createdAt go here.
  return {
    partyId: ref.partyId,
    scope: ref.scope,
    ...(ref.scope === "state" ? { stateId: ref.stateId } : {}),
    createdAt: now,
  };
}

export function isPartyTreasuryNegative(treasury: number | null | undefined): boolean {
  return (treasury ?? 0) < 0;
}

export async function findPartyBudgetForScope(
  collection: Collection<StoredPartyBudget>,
  ref: PartyBudgetScopeRef
): Promise<StoredPartyBudget | null> {
  const scopedBudget = await collection.findOne(buildStrictPartyBudgetFilter(ref));
  if (scopedBudget) return scopedBudget;

  return collection.findOne(buildLegacyPartyBudgetFilter(ref));
}

export async function savePartyBudgetForScope(
  collection: Collection<StoredPartyBudget>,
  ref: PartyBudgetScopeRef,
  fields: PartyBudgetMutableFields,
  now: Date = new Date()
): Promise<void> {
  const scopedBudget = await collection.findOne(buildStrictPartyBudgetFilter(ref));
  if (scopedBudget) {
    await collection.updateOne(buildStrictPartyBudgetFilter(ref), {
      $set: getPartyBudgetPersistedFields(scopedBudget, fields, ref.countryId, now),
    });
    return;
  }

  const legacyBudget = await collection.findOne(buildLegacyPartyBudgetFilter(ref));
  if (legacyBudget) {
    if (ref.scope === "state") {
      await collection.updateMany(buildCompatiblePartyBudgetFilter(ref), {
        $set: getPartyBudgetPersistedFields(legacyBudget, fields, ref.countryId, now),
      });
      return;
    }

    await collection.updateOne(
      buildStrictPartyBudgetFilter(ref),
      {
        $set: getPartyBudgetPersistedFields(legacyBudget, fields, ref.countryId, now),
        $setOnInsert: buildPartyBudgetInsertDefaults(ref, legacyBudget.createdAt ?? now),
      },
      { upsert: true }
    );
    return;
  }

  await collection.updateOne(
    buildStrictPartyBudgetFilter(ref),
    {
      $set: getPartyBudgetPersistedFields(undefined, fields, ref.countryId, now),
      $setOnInsert: buildPartyBudgetInsertDefaults(ref, now),
    },
    { upsert: true }
  );
}

export function getEffectivePartyBudgetSpending<
  T extends Pick<
    PartyBudget,
    | "gotvBudgetPerTurn"
    | "gotvBudgetPercent"
    | "suppressionBudgetPercent"
    | "orgBuildingPercent"
    | "gotvTargetCategory"
    | "gotvTargetGroup"
    | "suppressionTargetCategory"
    | "suppressionTargetGroup"
    | "registrationBudgetPercent"
    | "transferReserveAmount"
    | "memberSupportReserveAmount"
    | "nppRecruitmentReserveAmount"
    | "treasuryPreset"
  >,
>(budget: T | null | undefined, treasury: number | null | undefined) {
  if (!budget || !isPartyTreasuryNegative(treasury)) {
    return {
      gotvBudgetPerTurn: budget?.gotvBudgetPerTurn ?? 0,
      gotvBudgetPercent: budget?.gotvBudgetPercent ?? 0,
      gotvTargetCategory: budget?.gotvTargetCategory ?? null,
      gotvTargetGroup: budget?.gotvTargetGroup ?? null,
      suppressionBudgetPercent: budget?.suppressionBudgetPercent ?? 0,
      suppressionTargetCategory: budget?.suppressionTargetCategory ?? null,
      suppressionTargetGroup: budget?.suppressionTargetGroup ?? null,
      orgBuildingPercent: budget?.orgBuildingPercent ?? 0,
      registrationBudgetPercent: budget?.registrationBudgetPercent ?? 0,
      transferReserveAmount: budget?.transferReserveAmount ?? 0,
      memberSupportReserveAmount: budget?.memberSupportReserveAmount ?? 0,
      nppRecruitmentReserveAmount: budget?.nppRecruitmentReserveAmount ?? 0,
      treasuryPreset: budget?.treasuryPreset ?? ("custom" satisfies TreasuryPresetId),
      spendingDisabledByNegativeTreasury: false,
    };
  }

  return {
    gotvBudgetPerTurn: 0,
    gotvBudgetPercent: 0,
    gotvTargetCategory: budget.gotvTargetCategory ?? null,
    gotvTargetGroup: budget.gotvTargetGroup ?? null,
    suppressionBudgetPercent: 0,
    suppressionTargetCategory: budget.suppressionTargetCategory ?? null,
    suppressionTargetGroup: budget.suppressionTargetGroup ?? null,
    orgBuildingPercent: 0,
    registrationBudgetPercent: 0,
    transferReserveAmount: budget.transferReserveAmount ?? 0,
    memberSupportReserveAmount: budget.memberSupportReserveAmount ?? 0,
    nppRecruitmentReserveAmount: budget.nppRecruitmentReserveAmount ?? 0,
    treasuryPreset: budget.treasuryPreset ?? ("custom" satisfies TreasuryPresetId),
    spendingDisabledByNegativeTreasury: true,
  };
}

export async function resetPartyBudgetSpending(
  db: Db,
  ref: PartyBudgetScopeRef,
  now: Date = new Date()
): Promise<void> {
  const collection = db.collection<StoredPartyBudget>("partyBudget");

  if (ref.scope === "state") {
    await collection.updateMany(buildCompatiblePartyBudgetFilter(ref), {
      $set: {
        countryId: ref.countryId,
        gotvBudgetPerTurn: 0,
        gotvBudgetPercent: 0,
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        registrationBudgetPercent: 0,
        updatedAt: now,
      },
    });
    return;
  }

  const scopedBudget = await collection.findOne(buildStrictPartyBudgetFilter(ref));
  if (scopedBudget) {
    await collection.updateOne(buildStrictPartyBudgetFilter(ref), {
      $set: getPartyBudgetPersistedFields(
        scopedBudget,
        {
          gotvBudgetPerTurn: 0,
          gotvBudgetPercent: 0,
          suppressionBudgetPercent: 0,
          orgBuildingPercent: 0,
          registrationBudgetPercent: 0,
        },
        ref.countryId,
        now
      ),
    });
    return;
  }

  const legacyBudget = await collection.findOne(buildLegacyPartyBudgetFilter(ref));
  if (!legacyBudget) return;

  await collection.updateOne(
    buildStrictPartyBudgetFilter(ref),
    {
      $set: getPartyBudgetPersistedFields(
        legacyBudget,
        {
          gotvBudgetPerTurn: 0,
          gotvBudgetPercent: 0,
          suppressionBudgetPercent: 0,
          orgBuildingPercent: 0,
          registrationBudgetPercent: 0,
        },
        ref.countryId,
        now
      ),
      $setOnInsert: buildPartyBudgetInsertDefaults(ref, legacyBudget.createdAt ?? now),
    },
    { upsert: true }
  );
}
