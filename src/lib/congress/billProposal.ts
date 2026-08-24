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
import type { LegislationType, SubsidyProvision, EndSubsidyProvision } from "@/lib/db/types";
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
import { resolveProvisionPolicyOption } from "@/lib/legislature/provisionEnrichment";

// snapshotBillPolicyProvisions now lives in the shared provision-enrichment core
// so the regional bill paths can call it too. Re-exported for existing importers.
export { snapshotBillPolicyProvisions } from "@/lib/legislature/provisionEnrichment";

export interface ValidatedPolicyProvision {
  legislationTypeId: string;
  policyOptionId?: string;
  policyOptionNameSnapshot?: string;
  policyOptionExplanationSnapshot?: string;
  currentPolicyOptionIdSnapshot?: string;
  currentPolicyOptionNameSnapshot?: string;
  currentPolicyOptionExplanationSnapshot?: string;
  effectDirection: number;
  /** Omitted when the provision does not take a stance on this axis (0 is not centre). */
  economic?: number;
  social?: number;
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
    const rawType = "type" in (rawP as object) ? (rawP as { type: unknown }).type : undefined;
    if (rawType === "declare_war") {
      return {
        ok: false,
        status: 400,
        error:
          "A declaration of war is introduced by the head of government or the defence minister.",
      };
    }
    // A join-conflict provision is written ONLY by buildJoinConflictBill, from a
    // passed bloc resolution. Accepting one here would let any backbencher enter a
    // war at the simple majority this design deliberately keeps — bypassing the
    // foreign-minister gate, the org membership check and the bloc vote together.
    if (rawType === "join_conflict") {
      return {
        ok: false,
        status: 400,
        error: "Entry into a conflict is decided by a bloc resolution, not a bill.",
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
    // 0 means "no stance on this axis", not a centre target. Omitting the
    // field stops vote-time policy shift from recentring the legislator
    // (ticket #1116). Explicit non-zero values still stamp.
    const economic =
      p?.economic != null && typeof p.economic === "number"
        ? Math.max(-3, Math.min(3, Math.round(p.economic)))
        : undefined;
    const social =
      p?.social != null && typeof p.social === "number"
        ? Math.max(-3, Math.min(3, Math.round(p.social)))
        : undefined;
    const policyOptionId = typeof p?.policyOptionId === "string" ? p.policyOptionId : undefined;
    validatedPolicyProvisions.push({
      legislationTypeId: lt._id,
      ...(policyOptionId && { policyOptionId }),
      effectDirection,
      ...(economic ? { economic } : {}),
      ...(social ? { social } : {}),
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
