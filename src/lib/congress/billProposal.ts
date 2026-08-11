// src/lib/congress/billProposal.ts
// Provision validation for bill proposals. Called by the congress/bills POST route.
// Returns a typed result (ok/error) to preserve the route's logRequest pattern.

import { validateElectoralLawProvision } from "@/lib/elections/electoralLaws";
import type {
  CentralBankIndependenceProvision,
  ElectoralLawProvision,
} from "@/lib/db/types/legislation";
import { canLegislateBankIndependence } from "@/lib/centralBank/governance";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  EnactedLaw,
  LegislationPolicyOption,
  LegislationType,
  StatePolicy,
  SubsidyProvision,
  EndSubsidyProvision,
} from "@/lib/db/types";
import type {
  EmbargoProvision,
  EndEmbargoProvision,
  UnionLawProvision,
} from "@/lib/db/types/legislation";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  CATEGORY_TO_POLICY_DOMAINS,
  SUBSIDY_BILL_CATEGORIES,
  TARIFF_BILL_CATEGORIES,
  UNION_LAW_BILL_CATEGORIES,
  CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES,
  type BillCategory,
} from "@shared/constants/legislation";
import {
  UNION_LAW_BIAS_MIN,
  UNION_LAW_BIAS_MAX,
  clampUnionLawBias,
  isUnionLawBanAction,
} from "@/lib/labour/unionLaws";
import { getEraContext } from "@/lib/era/context";
import { resolveTaxSliderProvisionFields } from "@/lib/politicalLegislation/taxSlider";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
} from "@/lib/legislationTypeAliases";

export interface ValidatedPolicyProvision {
  legislationTypeId: string;
  policyOptionId?: string;
  policyOptionNameSnapshot?: string;
  currentPolicyOptionIdSnapshot?: string;
  currentPolicyOptionNameSnapshot?: string;
  effectDirection: number;
  economic: number;
  social: number;
  /** Tax-slider laws (ruling #16): the validated slider-chosen rate. */
  proposedRate?: number;
}

export type ValidatedProvisions =
  | {
      ok: true;
      policyProvisions: ValidatedPolicyProvision[];
      tariffProvisions: {
        type: "tariff";
        scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
        targetSectorType?: CorporationType;
        targetOriginCountryId?: CountryId;
        targetCorporationId?: ObjectId;
        rate: number;
      }[];
      subsidyProvisions: (SubsidyProvision | EndSubsidyProvision)[];
      embargoProvisions: (EmbargoProvision | EndEmbargoProvision)[];
      unionLawProvisions: UnionLawProvision[];
      electoralLawProvisions: ElectoralLawProvision[];
      centralBankProvisions: CentralBankIndependenceProvision[];
    }
  | { ok: false; status: number; error: string };

export async function validateBillProvisions(
  db: Db,
  rawProvisions: unknown[],
  category: string,
  /**
   * The bill's own country. When provided, embargo provisions are rejected if
   * they target it (a country cannot embargo itself). Centralizing the check
   * here means every caller of this validator is guarded, not just the ones that
   * remember to add their own check.
   */
  sourceCountry?: CountryId
): Promise<ValidatedProvisions> {
  const allowedDomains =
    CATEGORY_TO_POLICY_DOMAINS[category as keyof typeof CATEGORY_TO_POLICY_DOMAINS] ?? [];
  const { year: eraYear } = await getEraContext(db);
  const validatedPolicyProvisions: ValidatedPolicyProvision[] = [];
  const validatedTariffProvisions: {
    type: "tariff";
    scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
    targetSectorType?: CorporationType;
    targetOriginCountryId?: CountryId;
    targetCorporationId?: ObjectId;
    rate: number;
  }[] = [];
  const validatedSubsidyProvisions: (SubsidyProvision | EndSubsidyProvision)[] = [];
  const validatedEmbargoProvisions: (EmbargoProvision | EndEmbargoProvision)[] = [];
  const validatedUnionLawProvisions: UnionLawProvision[] = [];
  const validatedElectoralLawProvisions: ElectoralLawProvision[] = [];
  const validatedCentralBankProvisions: CentralBankIndependenceProvision[] = [];
  const isTradeCategory = TARIFF_BILL_CATEGORIES.has(category as BillCategory);

  for (const rawP of rawProvisions) {
    // A declaration of war is introduced by the EXECUTIVE, through its own route,
    // which authenticates the head of government or the defence seat. This path has
    // no such gate — it only checks that the proposer holds a legislative seat — so
    // accepting one here would let any backbencher take the country to war by
    // hand-rolling a provision. Refused outright rather than validated.
    if ("type" in (rawP as object) && (rawP as { type: unknown }).type === "declare_war") {
      return {
        ok: false,
        status: 400,
        error:
          "A declaration of war is introduced by the head of government or the defence minister.",
      };
    }

    // Handle subsidy / end_subsidy provisions
    if (
      "type" in (rawP as object) &&
      ((rawP as { type: unknown }).type === "subsidy" ||
        (rawP as { type: unknown }).type === "end_subsidy")
    ) {
      if (
        !SUBSIDY_BILL_CATEGORIES.has(category as Parameters<typeof SUBSIDY_BILL_CATEGORIES.has>[0])
      ) {
        return {
          ok: false,
          status: 400,
          error: "Subsidy provisions can only be included in industry bills.",
        };
      }
      const p = rawP as {
        type: "subsidy" | "end_subsidy";
        scopeType: "economy_wide" | "sector";
        targetSectorType?: string;
        targetStrategyId?: string;
        domesticOnly?: boolean;
      };
      if (p.scopeType === "sector" && !p.targetSectorType) {
        return {
          ok: false,
          status: 400,
          error: "Sector-scoped subsidy provisions must specify a target sector type.",
        };
      }
      if (p.type === "subsidy") {
        validatedSubsidyProvisions.push({
          type: "subsidy",
          scopeType: p.scopeType,
          ...(p.targetSectorType && { targetSectorType: p.targetSectorType as CorporationType }),
          ...(p.targetStrategyId && { targetStrategyId: p.targetStrategyId }),
          domesticOnly: p.domesticOnly ?? false,
        });
      } else {
        validatedSubsidyProvisions.push({
          type: "end_subsidy",
          scopeType: p.scopeType,
          ...(p.targetSectorType && { targetSectorType: p.targetSectorType as CorporationType }),
          ...(p.targetStrategyId && { targetStrategyId: p.targetStrategyId }),
        });
      }
      continue;
    }

    // Handle durable embargo / end_embargo provisions (trade bills only)
    if (
      "type" in (rawP as object) &&
      ((rawP as { type: unknown }).type === "embargo" ||
        (rawP as { type: unknown }).type === "end_embargo")
    ) {
      if (!isTradeCategory) {
        return {
          ok: false,
          status: 400,
          error: "Embargo provisions can only be included in trade bills.",
        };
      }
      const p = rawP as {
        type: "embargo" | "end_embargo";
        targetCountry: CountryId;
        commodity: CommodityType | "all";
        direction: "export" | "import" | "both";
        mode?: "block" | "cap";
        cap?: number;
      };
      if (sourceCountry && p.targetCountry === sourceCountry) {
        return { ok: false, status: 400, error: "A country cannot embargo itself." };
      }
      if (p.type === "end_embargo") {
        validatedEmbargoProvisions.push({
          type: "end_embargo",
          targetCountry: p.targetCountry,
          commodity: p.commodity,
          direction: p.direction,
        });
      } else {
        const mode = p.mode ?? "block";
        if (mode === "cap" && !(typeof p.cap === "number" && p.cap >= 0)) {
          return {
            ok: false,
            status: 400,
            error: "A capped embargo requires a non-negative cap.",
          };
        }
        validatedEmbargoProvisions.push({
          type: "embargo",
          targetCountry: p.targetCountry,
          commodity: p.commodity,
          direction: p.direction,
          mode,
          ...(mode === "cap" && typeof p.cap === "number" ? { cap: p.cap } : {}),
        });
      }
      continue;
    }

    // Handle electoral-law provisions (franchise + registration access)
    if ("type" in (rawP as object) && (rawP as { type: unknown }).type === "electoral_law") {
      const res = validateElectoralLawProvision(rawP, category);
      if (!res.ok) return { ok: false, status: 400, error: res.error };
      validatedElectoralLawProvisions.push(res.provision);
      continue;
    }

    // Central bank independence: grant hands rate-setting to the bank, revoke
    // returns it to the government. Economy bills only, and only for countries
    // whose bank is their own — a shared bank (ECB) is a treaty institution one
    // member's legislature cannot rewrite.
    if (
      "type" in (rawP as object) &&
      (rawP as { type: unknown }).type === "central_bank_independence"
    ) {
      if (
        !CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES.has(
          category as Parameters<typeof CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES.has>[0]
        )
      ) {
        return {
          ok: false,
          status: 400,
          error: "Central-bank-independence provisions can only be included in economy bills.",
        };
      }
      const p = rawP as { type: "central_bank_independence"; action?: unknown };
      if (p.action !== "grant" && p.action !== "revoke") {
        return {
          ok: false,
          status: 400,
          error: 'Central-bank-independence action must be "grant" or "revoke".',
        };
      }
      if (sourceCountry && !canLegislateBankIndependence(sourceCountry)) {
        return {
          ok: false,
          status: 400,
          error:
            "This country's central bank is a shared institution; its independence cannot be changed by national law.",
        };
      }
      validatedCentralBankProvisions.push({
        type: "central_bank_independence",
        action: p.action,
      });
      continue;
    }

    // Handle union-law provisions (v3 Phase 7b)
    if ("type" in (rawP as object) && (rawP as { type: unknown }).type === "union_law") {
      if (
        !UNION_LAW_BILL_CATEGORIES.has(
          category as Parameters<typeof UNION_LAW_BILL_CATEGORIES.has>[0]
        )
      ) {
        return {
          ok: false,
          status: 400,
          error: "Union-law provisions can only be included in industry bills.",
        };
      }
      const p = rawP as { type: "union_law"; bias: number; banAction?: unknown };
      // Union ban (player suggestion #93): a banAction provision carries no
      // meaningful bias (it deliberately leaves unionLawBias untouched at
      // enactment), so it's validated as its own arm.
      if (p.banAction !== undefined) {
        if (!isUnionLawBanAction(p.banAction)) {
          return {
            ok: false,
            status: 400,
            error: 'Union-law ban action must be "ban" or "repeal_ban".',
          };
        }
        validatedUnionLawProvisions.push({ type: "union_law", bias: 0, banAction: p.banAction });
        continue;
      }
      if (typeof p.bias !== "number" || !Number.isFinite(p.bias)) {
        return {
          ok: false,
          status: 400,
          error: "Union-law provisions must specify a numeric bias.",
        };
      }
      if (p.bias < UNION_LAW_BIAS_MIN || p.bias > UNION_LAW_BIAS_MAX) {
        return {
          ok: false,
          status: 400,
          error: `Union-law bias must be between ${UNION_LAW_BIAS_MIN} and ${UNION_LAW_BIAS_MAX}.`,
        };
      }
      validatedUnionLawProvisions.push({ type: "union_law", bias: clampUnionLawBias(p.bias) });
      continue;
    }

    // Handle tariff provisions
    if ("type" in (rawP as object) && (rawP as { type: unknown }).type === "tariff") {
      const p = rawP as {
        type: "tariff";
        scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
        targetSectorType?: CorporationType;
        targetOriginCountryId?: CountryId;
        targetCorporationId?: ObjectId;
        rate: number;
      };

      // Validate trade bills have valid tariff scopes
      if (category !== "trade") {
        return {
          ok: false,
          status: 400,
          error: "Tariff provisions can only be included in trade bills.",
        };
      }

      // Validate sector scope has targetSectorType
      if (p.scopeType === "sector" && !p.targetSectorType) {
        return {
          ok: false,
          status: 400,
          error: "Sector-scoped tariffs must specify a target sector type.",
        };
      }

      // Validate origin_country scope has targetOriginCountryId
      if (p.scopeType === "origin_country" && !p.targetOriginCountryId) {
        return {
          ok: false,
          status: 400,
          error: "Origin-country-scoped tariffs must specify a target origin country.",
        };
      }

      // Validate corporation scope has targetCorporationId
      if (p.scopeType === "corporation" && !p.targetCorporationId) {
        return {
          ok: false,
          status: 400,
          error: "Corporation-scoped tariffs must specify a target corporation.",
        };
      }

      validatedTariffProvisions.push({
        type: "tariff",
        scopeType: p.scopeType,
        ...(p.targetSectorType && { targetSectorType: p.targetSectorType }),
        ...(p.targetOriginCountryId && { targetOriginCountryId: p.targetOriginCountryId }),
        ...(p.targetCorporationId && {
          targetCorporationId: new ObjectId(p.targetCorporationId),
        }),
        rate: Math.max(0, Math.min(100, p.rate)),
      });
      continue;
    }

    // Handle policy provisions
    const p = rawP as {
      legislationTypeId: string;
      policyOptionId?: string;
      effectDirection: number;
      economic?: number;
      social?: number;
      proposedRate?: number;
    };

    const ltId = String(p?.legislationTypeId ?? "").trim();
    if (!ltId) {
      return { ok: false, status: 400, error: "Each provision must have a legislation type." };
    }
    const lt = await db.collection<LegislationType>("legislationTypes").findOne({ _id: ltId });
    if (!lt) {
      return { ok: false, status: 400, error: `Invalid legislation type: ${ltId}.` };
    }
    if (!isLegislationTypeActive(lt._id, eraYear)) {
      return {
        ok: false,
        status: 400,
        error: "This legislation is not available in this era.",
      };
    }
    if (!allowedDomains.includes(lt.policyDomain)) {
      return {
        ok: false,
        status: 400,
        error: `Legislation type "${lt.name}" is not in the selected category (${category}).`,
      };
    }

    // Tax-slider laws (ruling #16): server-side bounds/grid/min-step
    // validation against the CURRENT rate, with stamped delta-derived fields.
    if (lt.taxSlider) {
      const resolved = await resolveTaxSliderProvisionFields(
        db,
        lt,
        p?.proposedRate,
        typeof p?.policyOptionId === "string" ? p.policyOptionId : undefined,
        sourceCountry ?? "US"
      );
      if (!resolved.ok) {
        return { ok: false, status: 400, error: resolved.error };
      }
      validatedPolicyProvisions.push({
        legislationTypeId: lt._id,
        ...resolved.fields,
      });
      continue;
    }
    const effectDirection =
      p?.effectDirection != null && typeof p.effectDirection === "number"
        ? Math.max(-1, Math.min(1, Math.round(p.effectDirection)))
        : 0;
    const economic =
      p?.economic != null && typeof p.economic === "number"
        ? Math.max(-3, Math.min(3, Math.round(p.economic)))
        : 0;
    const social =
      p?.social != null && typeof p.social === "number"
        ? Math.max(-3, Math.min(3, Math.round(p.social)))
        : 0;
    const policyOptionId = typeof p?.policyOptionId === "string" ? p.policyOptionId : undefined;
    validatedPolicyProvisions.push({
      legislationTypeId: lt._id,
      ...(policyOptionId && { policyOptionId }),
      effectDirection,
      economic,
      social,
    });
  }

  return {
    ok: true,
    policyProvisions: validatedPolicyProvisions,
    tariffProvisions: validatedTariffProvisions,
    subsidyProvisions: validatedSubsidyProvisions,
    embargoProvisions: validatedEmbargoProvisions,
    unionLawProvisions: validatedUnionLawProvisions,
    electoralLawProvisions: validatedElectoralLawProvisions,
    centralBankProvisions: validatedCentralBankProvisions,
  };
}

function formatPolicyOptionLabel(option: LegislationPolicyOption): string {
  if (option.explanation?.includes(": ")) return option.explanation;
  if (option.explanation) return `${option.name}: ${option.explanation}`;
  return option.name;
}

function resolveProvisionPolicyOption(
  lt: LegislationType | null | undefined,
  provision: Pick<
    ValidatedPolicyProvision,
    "policyOptionId" | "economic" | "social" | "effectDirection"
  >
): LegislationPolicyOption | null {
  if (!lt?.policyOptions?.length) return null;

  if (provision.policyOptionId) {
    const exactOption = lt.policyOptions.find((opt) => opt.id === provision.policyOptionId);
    if (exactOption) return exactOption;
  }

  const explicitAxisMatch = lt.policyOptions.find(
    (opt) => (opt.economic ?? 0) === provision.economic && (opt.social ?? 0) === provision.social
  );
  if (explicitAxisMatch) return explicitAxisMatch;

  const directionMatches = lt.policyOptions.filter(
    (option) => option.effectDirection === provision.effectDirection
  );
  return directionMatches.length === 1 ? directionMatches[0] : null;
}

/**
 * Freeze the proposed/current provision labels at proposal time so historical
 * bill detail does not drift after the law changes.
 */
export async function snapshotBillPolicyProvisions(
  db: Db,
  policyStoreId: string,
  provisions: ValidatedPolicyProvision[]
): Promise<ValidatedPolicyProvision[]> {
  if (provisions.length === 0) return provisions;

  const canonicalLegTypeIds = [
    ...new Set(
      provisions
        .map((provision) => canonicalizeLegislationTypeId(provision.legislationTypeId))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const legTypeIds = [
    ...new Set(canonicalLegTypeIds.flatMap((id) => getEquivalentLegislationTypeIds(id))),
  ];

  const [legislationTypes, currentPolicies] = await Promise.all([
    db
      .collection<LegislationType>("legislationTypes")
      .find({ _id: { $in: legTypeIds } })
      .toArray(),
    db
      .collection<StatePolicy>("statePolicies")
      .find({ stateId: policyStoreId, legislationTypeId: { $in: legTypeIds } })
      .toArray(),
  ]);

  const legislationTypeMap = new Map<string, LegislationType>();
  for (const lt of legislationTypes) {
    const canonicalId = canonicalizeLegislationTypeId(lt._id);
    if (!canonicalId) continue;
    if (!legislationTypeMap.has(canonicalId) || lt._id === canonicalId) {
      legislationTypeMap.set(canonicalId, lt);
    }
  }

  const currentPolicyIdMap = new Map<string, string>();
  for (const policy of currentPolicies) {
    const canonicalId = canonicalizeLegislationTypeId(policy.legislationTypeId);
    if (!canonicalId) continue;
    if (!currentPolicyIdMap.has(canonicalId) || policy.legislationTypeId === canonicalId) {
      currentPolicyIdMap.set(canonicalId, policy.policyOptionId);
    }
  }

  const missingTypeIds = canonicalLegTypeIds.filter((id) => !currentPolicyIdMap.has(id));
  if (missingTypeIds.length > 0) {
    const countryId = inferCountryIdFromStateId(policyStoreId);
    const enactedLawFilter: Record<string, unknown> = {
      legislationTypeId: {
        $in: missingTypeIds.flatMap((id) => getEquivalentLegislationTypeIds(id)),
      },
      repealedAt: { $exists: false },
    };
    if (countryId) {
      enactedLawFilter.scope = "national";
      enactedLawFilter.countryId = countryId;
    } else {
      enactedLawFilter.scope = "state";
      enactedLawFilter.stateId = policyStoreId;
    }

    const enactedLaws = await db
      .collection<EnactedLaw>("enactedLaws")
      .find(enactedLawFilter)
      .sort({ enactedAt: -1 })
      .toArray();

    const seenCanonicalIds = new Set<string>();
    for (const law of enactedLaws) {
      const canonicalId = canonicalizeLegislationTypeId(law.legislationTypeId);
      if (!canonicalId || seenCanonicalIds.has(canonicalId)) continue;
      seenCanonicalIds.add(canonicalId);

      const lt = legislationTypeMap.get(canonicalId);
      const currentOption = lt?.policyOptions?.[law.policyOptionIndex ?? -1];
      if (currentOption?.id) {
        currentPolicyIdMap.set(canonicalId, currentOption.id);
      }
    }
  }

  return provisions.map((provision) => {
    const canonicalId =
      canonicalizeLegislationTypeId(provision.legislationTypeId) ?? provision.legislationTypeId;
    const lt = legislationTypeMap.get(canonicalId);
    const proposedOption = resolveProvisionPolicyOption(lt, provision);
    const currentPolicyOptionId = currentPolicyIdMap.get(canonicalId);
    const currentPolicyOption = currentPolicyOptionId
      ? lt?.policyOptions?.find((option) => option.id === currentPolicyOptionId)
      : undefined;

    return {
      ...provision,
      ...(proposedOption
        ? { policyOptionNameSnapshot: formatPolicyOptionLabel(proposedOption) }
        : {}),
      ...(currentPolicyOptionId ? { currentPolicyOptionIdSnapshot: currentPolicyOptionId } : {}),
      ...(currentPolicyOption
        ? { currentPolicyOptionNameSnapshot: formatPolicyOptionLabel(currentPolicyOption) }
        : {}),
    };
  });
}
