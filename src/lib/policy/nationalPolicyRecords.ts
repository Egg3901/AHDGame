import type { Db, ObjectId } from "mongodb";
import type {
  StatePolicyRecord,
  LegislationType,
  LegislationPolicyOption,
  GovernorExecutiveOrder,
} from "@/lib/db/types";
import { NATIONAL_POLICY_STATE_IDS } from "@/lib/policy/nationalStateId";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { FederalBudget, FederalTaxRates } from "@/lib/db/types/budget";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
  getLegislationTypeById,
} from "@/lib/legislationTypeAliases";
import { legislationTypes as seededLegislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";
import type {
  PolicyMetricEffect,
  PolicyRecordResponse,
  WeightedPolicyEffect,
} from "@/lib/policy/types";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types";
import { taxSliderRateLabel } from "@/lib/politicalLegislation/taxSlider";

/**
 * Shared national policy-record assembly — extracted verbatim from
 * `GET /api/country/[code]/policy` so the national-axes route reads the
 * exact same record set the National Policy page lists (SSOT for the
 * National Ideology averages).
 */

export type PolicyRecordLike = Pick<
  StatePolicyRecord,
  "legislationTypeId" | "economic" | "social" | "updatedAt"
> & {
  scope: "national" | "state";
  stateId?: string;
  policyOptionId?: string;
  policyOptionIndex?: number;
  enactedBy?: { kind: "bill" | "order" | "expiry"; id: ObjectId } | null;
};

export type ActiveOrderInfo = NonNullable<PolicyRecordResponse["activeOrder"]>;

const LEGISLATION_COUNTRY_SCOPES: Record<
  CountryId,
  NonNullable<LegislationType["countryScope"]>
> = {
  US: "us",
  UK: "uk",
  JP: "jp",
  DE: "de",
  IE: "ie",
  BR: "br",
  CN: "cn",
  NG: "ng",
  HU: "hu",
  PL: "pl",
  RO: "ro",
  YU: "yu",
  BG: "bg",
  BLR: "blr",
  UKR: "ukr",
  CS: "cs",
  BAL: "bal",
  RU: "ru",
  FR: "fr",
  IT: "it",
  ES: "es",
  SE: "se",
  TR: "tr",
  GR: "gr",
  AT: "at",
  FI: "fi",
  DD: "dd",
  SCO: "sco",
  WAL: "wls",
};

/**
 * Country filter for national enactedLaws — legacy US rows predate countryId.
 * (Same shape as the local copies in budget/spending.ts and
 * publicFinance/queries/federalBudgetDetail.ts.)
 */
export function nationalLawCountryQuery(countryId: CountryId) {
  if (countryId === COUNTRY_CONFIGS.US.id) {
    return {
      $or: [{ countryId: COUNTRY_CONFIGS.US.id }, { countryId: { $exists: false } }],
    };
  }

  return { countryId };
}

export function getCountryLegislationTypeQuery(countryId: CountryId) {
  const countryScope = LEGISLATION_COUNTRY_SCOPES[countryId];
  if (countryId === COUNTRY_CONFIGS.US.id) {
    return {
      $or: [{ countryScope }, { countryScope: { $exists: false } }],
    };
  }
  return { countryScope };
}

export function matchesCountryLegislationType(
  countryId: CountryId,
  legislationType: LegislationType
): boolean {
  const countryScope = LEGISLATION_COUNTRY_SCOPES[countryId];

  if (countryId === COUNTRY_CONFIGS.US.id) {
    return !legislationType.countryScope || legislationType.countryScope === countryScope;
  }

  return legislationType.countryScope === countryScope;
}

export interface CountryLegislationTypes {
  legislationTypes: LegislationType[];
  legislationTypeMap: Map<string, LegislationType>;
  /** Every equivalent (alias) id for the country's types. */
  legislationTypeIds: Set<string>;
}

/** Seeded types merged with DB overrides, keyed by id (DB wins). */
export async function loadCountryLegislationTypes(
  db: Db,
  countryId: CountryId
): Promise<CountryLegislationTypes> {
  const dbLegislationTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find(getCountryLegislationTypeQuery(countryId))
    .toArray();
  const legislationTypeMap = new Map<string, LegislationType>();
  for (const legislationType of seededLegislationTypes.filter((candidate) =>
    matchesCountryLegislationType(countryId, candidate)
  )) {
    legislationTypeMap.set(legislationType._id, legislationType);
  }
  for (const legislationType of dbLegislationTypes) {
    legislationTypeMap.set(legislationType._id, legislationType);
  }
  const legislationTypes = [...legislationTypeMap.values()];
  const legislationTypeIds = new Set<string>();
  for (const legislationType of legislationTypes) {
    for (const candidateId of getEquivalentLegislationTypeIds(legislationType._id)) {
      legislationTypeIds.add(candidateId);
    }
  }
  return { legislationTypes, legislationTypeMap, legislationTypeIds };
}

export function findMatchedTaxRateOption(
  options: LegislationPolicyOption[] | undefined,
  targetRate: number
): LegislationPolicyOption | null {
  if (!options?.length) return null;

  const exact = options.find((option) => option.rate === targetRate);
  if (exact) return exact;

  let best: LegislationPolicyOption | null = null;
  let bestDistance = Infinity;
  for (const option of options) {
    if (typeof option.rate !== "number") continue;
    const distance = Math.abs(option.rate - targetRate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

export function getBudgetTaxRate(
  budget: FederalBudget | null,
  taxType: keyof FederalTaxRates
): number | undefined {
  if (!budget?.taxRates) return undefined;

  const taxRates = budget.taxRates as FederalTaxRates & {
    corporateTax?: number;
  };
  const directRate = taxRates[taxType];
  if (typeof directRate === "number") return directRate;

  // Older live budgets stored a single `corporateTax` rate before the domestic/foreign split.
  if (
    (taxType === "domesticCorporateTax" || taxType === "foreignCorporateTax") &&
    typeof taxRates.corporateTax === "number"
  ) {
    return taxRates.corporateTax;
  }

  return undefined;
}

export function findMatchedOption(
  options: LegislationPolicyOption[] | undefined,
  economic: number,
  social: number
): LegislationPolicyOption | null {
  if (!options?.length) return null;
  const exact = options.find((o) => o.economic === economic && o.social === social);
  if (exact) return exact;
  let best: LegislationPolicyOption | null = null;
  let bestDist = Infinity;
  for (const o of options) {
    const dist = Math.abs((o.economic ?? 0) - economic) + Math.abs((o.social ?? 0) - social);
    if (dist < bestDist) {
      bestDist = dist;
      best = o;
    }
  }
  return best;
}

export function buildPolicyResponse(
  record: PolicyRecordLike,
  legislationType: LegislationType,
  activeOrder?: ActiveOrderInfo | null,
  budget?: FederalBudget | null
): PolicyRecordResponse {
  const economic = record.economic ?? 0;
  const social = record.social ?? 0;
  const matchedOption = findMatchedOption(legislationType.policyOptions, economic, social);
  const encodedSliderRate =
    legislationType.taxSlider && record.policyOptionId?.startsWith("rate:")
      ? Number(record.policyOptionId.slice("rate:".length))
      : null;
  const sliderTaxType = legislationType.taxSlider?.taxType as keyof FederalTaxRates | undefined;
  const currentSliderRate = sliderTaxType
    ? getBudgetTaxRate(budget ?? null, sliderTaxType)
    : undefined;
  const pendingSliderRate = sliderTaxType ? budget?.taxRatePhaseIn?.[sliderTaxType] : undefined;
  const policyOptionName =
    typeof currentSliderRate === "number" && Number.isFinite(currentSliderRate)
      ? typeof pendingSliderRate === "number" &&
        Number.isFinite(pendingSliderRate) &&
        pendingSliderRate !== currentSliderRate
        ? `${taxSliderRateLabel(currentSliderRate)} (target ${pendingSliderRate}%, phasing in)`
        : taxSliderRateLabel(currentSliderRate)
      : encodedSliderRate !== null && Number.isFinite(encodedSliderRate)
        ? taxSliderRateLabel(encodedSliderRate)
        : (matchedOption?.name ?? null);
  const metricEffects: PolicyMetricEffect[] = (matchedOption?.metricEffects ?? [])
    // 📊 budget-sync: computed fiscal metrics are mirror-owned — laws don't move
    // them, so they aren't surfaced as policy-record effects.
    .filter((effect) => !MIRROR_CONTROLLED_METRIC_IDS.has(effect.metricId))
    .map((effect) => ({
      category: effect.category,
      metricId: effect.metricId,
      ratePerTurn: effect.ratePerTurn,
    }));

  const hasEconomic =
    (legislationType.policyOptions?.some((option) => option.economic !== 0) ?? false) ||
    economic !== 0;
  const hasSocial =
    (legislationType.policyOptions?.some((option) => option.social !== 0) ?? false) || social !== 0;

  const effectDirection =
    matchedOption?.effectDirection ?? (economic > 0 ? 1 : economic < 0 ? -1 : 0);
  const metricEffectIds = new Set(metricEffects.map((e) => e.metricId));
  const weightedEffects: WeightedPolicyEffect[] = [];
  if (effectDirection !== 0) {
    for (const target of legislationType.effectTargetsWeighted ?? []) {
      if (MIRROR_CONTROLLED_METRIC_IDS.has(target.metricId)) continue;
      if (metricEffectIds.has(target.metricId)) continue;
      const def = getMetricDefinition(target.metricCategoryId as MetricCategoryId, target.metricId);
      const isHigherBetter = def?.isHigherBetter ?? true;
      const weightSign = target.weight >= 0 ? 1 : -1;
      const contributionSign = effectDirection * weightSign * (isHigherBetter ? 1 : -1);
      if (contributionSign === 0) continue;
      weightedEffects.push({
        metricCategoryId: target.metricCategoryId,
        metricId: target.metricId,
        isPositive: contributionSign > 0,
      });
    }
  }

  return {
    recordType: "policy",
    legislationTypeId: canonicalizeLegislationTypeId(legislationType._id) ?? legislationType._id,
    name: legislationType.name,
    policyDomain: legislationType.policyDomain ?? "governance",
    economic,
    social,
    nationalOnly: legislationType.nationalOnly ?? record.scope === "national",
    policyOptionName,
    hasEconomic,
    hasSocial,
    metricEffects,
    weightedEffects,
    enactedByKind: record.enactedBy?.kind ?? null,
    activeOrder: activeOrder ?? null,
  };
}

export function mergePolicyRecordsByCanonicalId(
  records: PolicyRecordLike[]
): Map<string, PolicyRecordLike> {
  const merged = new Map<string, PolicyRecordLike>();
  for (const record of records) {
    const canonicalId =
      canonicalizeLegislationTypeId(record.legislationTypeId) ?? record.legislationTypeId;
    const existing = merged.get(canonicalId);
    const isExactCanonical = record.legislationTypeId === canonicalId;
    const existingIsExactCanonical = existing?.legislationTypeId === canonicalId;
    if (!existing || (isExactCanonical && !existingIsExactCanonical)) {
      merged.set(canonicalId, {
        ...record,
        legislationTypeId: canonicalId,
      });
    }
  }
  return merged;
}

export function backfillNationalTaxPolicyRecords(args: {
  budget: FederalBudget | null;
  legislationTypes: LegislationType[];
  nationalStateId: string;
  recordsByCanonicalId: Map<string, PolicyRecordLike>;
}) {
  const { budget, legislationTypes, nationalStateId, recordsByCanonicalId } = args;
  if (!budget?.taxRates) return;

  const typeByCanonicalId = new Map(
    legislationTypes.map((type) => [canonicalizeLegislationTypeId(type._id) ?? type._id, type])
  );
  const controlledTaxTypes = new Set<string>();
  for (const record of recordsByCanonicalId.values()) {
    const type = typeByCanonicalId.get(record.legislationTypeId);
    const controller =
      type?.taxSlider?.scope === "federal"
        ? type.taxSlider.taxType
        : type?.taxRateChange?.scope === "federal"
          ? type.taxRateChange.taxType
          : undefined;
    if (controller) controlledTaxTypes.add(controller);
  }

  for (const legislationType of legislationTypes) {
    if (legislationType.policyDomain !== "tax") continue;
    if (legislationType.taxRateChange?.scope !== "federal") continue;

    const canonicalId = canonicalizeLegislationTypeId(legislationType._id) ?? legislationType._id;
    if (recordsByCanonicalId.has(canonicalId)) continue;

    const taxType = legislationType.taxRateChange.taxType as keyof FederalTaxRates;
    if (controlledTaxTypes.has(taxType)) continue;
    const currentRate = getBudgetTaxRate(budget, taxType);
    if (typeof currentRate !== "number") continue;

    const matchedOption = findMatchedTaxRateOption(legislationType.policyOptions, currentRate);
    recordsByCanonicalId.set(canonicalId, {
      scope: "national",
      stateId: nationalStateId,
      legislationTypeId: canonicalId,
      economic: matchedOption?.economic ?? 0,
      social: matchedOption?.social ?? 0,
      policyOptionId: matchedOption?.id,
      updatedAt: budget.updatedAt,
    });
    controlledTaxTypes.add(taxType);
  }
}

export interface NationalPolicyAssembly {
  records: PolicyRecordResponse[];
  types: CountryLegislationTypes;
}

/**
 * The country's implemented national laws as PolicyRecordResponse rows —
 * statePolicies (canonical-merged) + federal tax backfill + active-order
 * attribution. Exactly the policy-record portion of the policy route's
 * national branch (tariffs/subsidies excluded).
 */
export async function assembleNationalPolicyRecords(
  db: Db,
  countryId: CountryId
): Promise<NationalPolicyAssembly> {
  const types = await loadCountryLegislationTypes(db, countryId);
  const nationalStateId = NATIONAL_POLICY_STATE_IDS[countryId];
  const policies = await db
    .collection<StatePolicyRecord>("statePolicies")
    .find({
      scope: "national",
      $or: [
        { stateId: nationalStateId },
        {
          stateId: { $exists: false },
          legislationTypeId: { $in: [...types.legislationTypeIds] },
        },
      ],
    })
    .toArray();
  const budgetId = countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });

  const recordsByCanonicalId = mergePolicyRecordsByCanonicalId(policies);
  backfillNationalTaxPolicyRecords({
    budget,
    legislationTypes: types.legislationTypes,
    nationalStateId,
    recordsByCanonicalId,
  });

  // Surface active presidential executive orders for the federal scope.
  const activeOrders = await db
    .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
    .find({ countryId, stateId: nationalStateId, status: "active" })
    .toArray();
  const activeOrderById = new Map(activeOrders.map((o) => [o._id!.toString(), o]));

  const records: PolicyRecordResponse[] = [...recordsByCanonicalId.values()]
    .map((record) => {
      const legislationType = getLegislationTypeById(
        types.legislationTypeMap,
        record.legislationTypeId
      );
      if (!legislationType) return null;
      let activeOrder: ActiveOrderInfo | null = null;
      if (record.enactedBy?.kind === "order") {
        const order = activeOrderById.get(record.enactedBy.id.toString());
        if (order) {
          activeOrder = {
            orderId: order._id!.toString(),
            issuedByName: order.issuedByName,
            issuedAtTurn: order.issuedAtTurn,
            expiresAtTurn: order.expiresAtTurn,
          };
        }
      }
      return buildPolicyResponse(record, legislationType, activeOrder, budget);
    })
    .filter((record): record is PolicyRecordResponse => record !== null);

  return { records, types };
}
