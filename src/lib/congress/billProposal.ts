import { loadEuroMonetaryUnion } from "@/lib/currency/euro/service";
// src/lib/congress/billProposal.ts
// Provision validation for bill proposals. Called by the congress/bills POST route.
// Returns a typed result (ok/error) to preserve the route's logRequest pattern.

import { loadEuropeanTreatyContext } from "@/lib/internationalOrganizations/europeanIntegration/service";
import { canRatifyMaastricht } from "@/lib/internationalOrganizations/europeanIntegration/rules";
import { validateElectoralLawProvision } from "@/lib/elections/electoralLaws";
import type {
  EuropeanTreatyProvision,
  CentralBankIndependenceProvision,
  EconomicSystemReformProvision,
  EuroAdoptionProvision,
  ElectoralLawProvision,
  ResetLawProvision,
} from "@/lib/db/types/legislation";
import { canLegislateBankIndependence } from "@/lib/centralBank/governance";
import {
  ECONOMIC_SYSTEM_TARGETS,
  canLegislateEconomicSystem,
} from "@/lib/economy/economicSystemReformRules";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { LegislationType, SubsidyProvision, EndSubsidyProvision } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import type {
  EmbargoProvision,
  EndEmbargoProvision,
  UnionLawProvision,
} from "@/lib/db/types/legislation";
import { loadEuroAdoptionConditions } from "@/lib/currency/euro/adoption";
import { euroAdoptionRefusal } from "@/lib/currency/euro/rules";
import { type CountryId } from "@/lib/constants/countries";
import type { OperatingSectorType } from "@/lib/constants/corporations";
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
import { validateBillAdministration } from "@/lib/legislature/jurisdiction";
import { findAdministrationConflict } from "@/lib/legislature/administrationConflictCheck";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { isResetV2Country, resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import { loadReviewedLawCatalog } from "@/lib/resetLegislation/loadReviewedCatalog";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import type { LawChoice } from "@/lib/resetLegislation/rules/eligibility";
import { resetTaxesFor } from "@/lib/resetLegislation/taxCatalog";
import { resolveResetTaxProvisionFields } from "@/lib/resetLegislation/resolveTaxProvision";
import { marketAtLeast } from "@/lib/market/featureFlag";
import { isMediaOwnershipBillAvailable } from "@/lib/mediaRegulation/rules";
import { loadUSMediaOutletDelivery } from "@/lib/mediaRegulation/turnData";

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
        targetSectorType?: OperatingSectorType;
        targetOriginCountryId?: CountryId;
        targetCorporationId?: ObjectId;
        rate: number;
      }[];
      subsidyProvisions: (SubsidyProvision | EndSubsidyProvision)[];
      embargoProvisions: (EmbargoProvision | EndEmbargoProvision)[];
      unionLawProvisions: UnionLawProvision[];
      electoralLawProvisions: ElectoralLawProvision[];
      centralBankProvisions: CentralBankIndependenceProvision[];
      economicSystemReformProvisions: EconomicSystemReformProvision[];
      euroAdoptionProvisions: EuroAdoptionProvision[];
      europeanTreatyProvisions: EuropeanTreatyProvision[];
      resetLawProvisions: ResetLawProvision[];
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
  sourceCountry?: CountryId,
  administration?: { enabled: boolean }
): Promise<ValidatedProvisions> {
  const allowedDomains =
    CATEGORY_TO_POLICY_DOMAINS[category as keyof typeof CATEGORY_TO_POLICY_DOMAINS] ?? [];
  const { year: eraYear, currentTurn, mediaRegulation } = await getEraContext(db);
  const resetState =
    sourceCountry && isResetV2Country(sourceCountry)
      ? await db.collection<GameState>("gameState").findOne(
          { _id: "current" },
          {
            projection: {
              resetWorldId: 1,
              startingYear: 1,
              metricsSystemVersion: 1,
              legislationSystemVersion: 1,
              resetVersionSeeds: 1,
            },
          }
        )
      : null;
  const resetLegislationV2 =
    sourceCountry != null &&
    resetSystemVersionsForCountry(resetState, RESET_V2_READY, sourceCountry).legislation === "v2";
  const validatedPolicyProvisions: ValidatedPolicyProvision[] = [];
  const validatedTariffProvisions: {
    type: "tariff";
    scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
    targetSectorType?: OperatingSectorType;
    targetOriginCountryId?: CountryId;
    targetCorporationId?: ObjectId;
    rate: number;
  }[] = [];
  const validatedSubsidyProvisions: (SubsidyProvision | EndSubsidyProvision)[] = [];
  const validatedEmbargoProvisions: (EmbargoProvision | EndEmbargoProvision)[] = [];
  const validatedUnionLawProvisions: UnionLawProvision[] = [];
  const validatedElectoralLawProvisions: ElectoralLawProvision[] = [];
  const validatedCentralBankProvisions: CentralBankIndependenceProvision[] = [];
  const validatedLegislationTypes: LegislationType[] = [];
  const validatedEconomicSystemReformProvisions: EconomicSystemReformProvision[] = [];
  const validatedEuroAdoptionProvisions: EuroAdoptionProvision[] = [];
  const validatedEuropeanTreatyProvisions: EuropeanTreatyProvision[] = [];
  const validatedResetLawProvisions: ResetLawProvision[] = [];
  const resetFamilyIds = new Set<string>();
  const resetTaxTypeIds = new Set<string>();
  let reviewedNationalCatalog: Awaited<ReturnType<typeof loadReviewedLawCatalog>> | null = null;
  const isTradeCategory = TARIFF_BILL_CATEGORIES.has(category as BillCategory);
  const requestedLegislationTypeIds = Array.from(
    new Set(
      rawProvisions
        .map((provision) =>
          String((provision as { legislationTypeId?: unknown })?.legislationTypeId ?? "").trim()
        )
        .filter(Boolean)
    )
  );
  const legislationTypes = requestedLegislationTypeIds.length
    ? await db
        .collection<LegislationType>("legislationTypes")
        .find({ _id: { $in: requestedLegislationTypeIds } })
        .toArray()
    : [];
  const legislationTypeById = new Map(
    legislationTypes.map((legislationType) => [legislationType._id, legislationType])
  );

  for (const rawP of rawProvisions) {
    // A declaration of war is introduced by the EXECUTIVE, through its own route,
    // which authenticates the head of government or the defence seat. This path has
    // no such gate — it only checks that the proposer holds a legislative seat — so
    // accepting one here would let any backbencher take the country to war by
    // hand-rolling a provision. Refused outright rather than validated.
    const rawType =
      typeof rawP === "object" && rawP !== null && "type" in rawP
        ? (rawP as { type: unknown }).type
        : undefined;
    if (resetLegislationV2 && rawType !== undefined && rawType !== "reset_law") {
      return {
        ok: false,
        status: 409,
        error: "This world accepts only reviewed legislation v2 provisions.",
      };
    }
    if (rawType === "reset_law") {
      const selection = rawP as {
        familyId?: unknown;
        scope?: unknown;
        regionId?: unknown;
        choice?: unknown;
      };
      if (
        !sourceCountry ||
        !isResetV2Country(sourceCountry) ||
        selection.scope !== "national" ||
        selection.regionId !== undefined ||
        typeof selection.familyId !== "string" ||
        typeof selection.choice !== "string"
      ) {
        return {
          ok: false,
          status: 400,
          error: "This proposal route accepts only national v2 law selections.",
        };
      }
      if (resetFamilyIds.has(selection.familyId)) {
        return { ok: false, status: 400, error: "A v2 bill cannot repeat a law family." };
      }
      if (!reviewedNationalCatalog) {
        if (!resetState?.resetWorldId || !resetLegislationV2) {
          return { ok: false, status: 409, error: "Legislation v2 is not enabled." };
        }
        reviewedNationalCatalog = await loadReviewedLawCatalog({
          db,
          worldId: resetState.resetWorldId,
          country: sourceCountry as ResetCountry,
          scope: "national",
          year: eraYear ?? resetState.startingYear ?? 1991,
        });
      }
      const family = reviewedNationalCatalog.find(
        (candidate) => candidate.familyId === selection.familyId
      );
      const entry = family?.options.find(
        (candidate) => candidate.option.choice === selection.choice
      );
      if (!family || !entry) {
        return { ok: false, status: 400, error: "This v2 law option is unavailable." };
      }
      if (entry.option.choice === entry.currentChoice) {
        return { ok: false, status: 400, error: "The selected option is already current law." };
      }
      resetFamilyIds.add(family.familyId);
      validatedResetLawProvisions.push({
        type: "reset_law",
        familyId: family.familyId,
        scope: "national",
        choice: entry.option.choice as LawChoice,
        reviewedOption: entry.option,
        titleSnapshot: entry.title,
        descriptionSnapshot: entry.description,
        currentLawSnapshot: family.currentLaw,
        currentLawDescriptionSnapshot: family.currentLawDescription,
        currentChoiceSnapshot: entry.currentChoice,
        currentAnnualAllocationSnapshot: entry.currentAnnualAllocation,
        annualAllocationDeltaSnapshot: entry.annualAllocationDelta,
        overseeingSeatIdSnapshot: family.overseeingSeatId,
        overseeingAgencyIdSnapshot: family.overseeingAgencyId,
        primaryMetricEffectsSnapshot: entry.primaryMetricEffects,
        balanceBasis: entry.balanceBasis,
      });
      continue;
    }
    if (rawType === "european_treaty") {
      const provision = rawP as Partial<EuropeanTreatyProvision>;
      if (
        category !== "foreign policy" ||
        provision.treaty !== "maastricht" ||
        (provision.action !== "ratify" && provision.action !== "reject")
      )
        return {
          ok: false,
          status: 400,
          error:
            "Maastricht decisions require a foreign policy bill with a ratify or reject action.",
        };
      if (validatedEuropeanTreatyProvisions.length)
        return {
          ok: false,
          status: 400,
          error: "A bill can contain only one Maastricht decision.",
        };
      const context = await loadEuropeanTreatyContext(db);
      if (
        !sourceCountry ||
        !context ||
        !context.members.includes(sourceCountry) ||
        !canRatifyMaastricht(context.date, context.state.stage)
      )
        return {
          ok: false,
          status: 400,
          error: "Maastricht ratification is not open to this country.",
        };
      validatedEuropeanTreatyProvisions.push({
        type: "european_treaty",
        treaty: "maastricht",
        action: provision.action,
      });
      continue;
    }
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
    if (rawType === "subsidy" || rawType === "end_subsidy") {
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
          ...(p.targetSectorType && {
            targetSectorType: p.targetSectorType as OperatingSectorType,
          }),
          ...(p.targetStrategyId && { targetStrategyId: p.targetStrategyId }),
          domesticOnly: p.domesticOnly ?? false,
        });
      } else {
        validatedSubsidyProvisions.push({
          type: "end_subsidy",
          scopeType: p.scopeType,
          ...(p.targetSectorType && {
            targetSectorType: p.targetSectorType as OperatingSectorType,
          }),
          ...(p.targetStrategyId && { targetStrategyId: p.targetStrategyId }),
        });
      }
      continue;
    }

    // Handle durable embargo / end_embargo provisions (trade bills only)
    if (rawType === "embargo" || rawType === "end_embargo") {
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
    if (rawType === "electoral_law") {
      const rawElectoralLaw = rawP as { japanShugiinReform?: unknown };
      const reformContext =
        rawElectoralLaw.japanShugiinReform === true
          ? await db
              .collection<GameState>("gameState")
              .findOne({ _id: "current" }, { projection: { preset: 1, currentYear: 1 } })
          : null;
      const res = validateElectoralLawProvision(rawP, category, {
        countryId: sourceCountry,
        preset: reformContext?.preset,
        currentYear: reformContext?.currentYear,
      });
      if (!res.ok) return { ok: false, status: 400, error: res.error };
      validatedElectoralLawProvisions.push(res.provision);
      continue;
    }

    if (rawType === "euro_adoption") {
      if (category !== "economy") {
        return { ok: false, status: 400, error: "Euro adoption belongs in an economy bill." };
      }
      if (!sourceCountry) {
        return { ok: false, status: 400, error: "This country is not eligible for euro adoption." };
      }
      if (validatedEuroAdoptionProvisions.length > 0) {
        return {
          ok: false,
          status: 400,
          error: "A bill can contain only one euro-adoption provision.",
        };
      }
      const refusal = euroAdoptionRefusal(await loadEuroAdoptionConditions(db, sourceCountry));
      if (refusal) return { ok: false, status: 400, error: refusal };
      validatedEuroAdoptionProvisions.push({ type: "euro_adoption" });
      continue;
    }

    // Central bank independence: grant hands rate-setting to the bank, revoke
    // returns it to the government. Economy bills only, and only for countries
    // whose bank is their own — a shared bank (ECB) is a treaty institution one
    // member's legislature cannot rewrite.
    if (rawType === "central_bank_independence") {
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
      if (
        sourceCountry &&
        (!canLegislateBankIndependence(sourceCountry) ||
          (await loadEuroMonetaryUnion(db))?.members[sourceCountry])
      ) {
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

    // Economic system reform: a legislated target for the marketization dial.
    // Economy bills only, one per bill, and only where the era began planned.
    if (rawType === "economic_system_reform") {
      if (
        !CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES.has(
          category as Parameters<typeof CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES.has>[0]
        )
      ) {
        return {
          ok: false,
          status: 400,
          error: "Economic system reform can only be included in economy bills.",
        };
      }
      const p = rawP as { type: "economic_system_reform"; target?: unknown };
      if (!ECONOMIC_SYSTEM_TARGETS.includes(p.target as EconomicSystemReformProvision["target"])) {
        return {
          ok: false,
          status: 400,
          error: 'Economic system target must be "dual_track", "market" or "command".',
        };
      }
      if (sourceCountry && !canLegislateEconomicSystem(sourceCountry)) {
        return {
          ok: false,
          status: 400,
          error: "Only countries with a planned economy can legislate their economic system.",
        };
      }
      if (validatedEconomicSystemReformProvisions.length > 0) {
        return {
          ok: false,
          status: 400,
          error: "A bill can carry only one economic system reform.",
        };
      }
      validatedEconomicSystemReformProvisions.push({
        type: "economic_system_reform",
        target: p.target as EconomicSystemReformProvision["target"],
      });
      continue;
    }

    // Handle union-law provisions (v3 Phase 7b)
    if (rawType === "union_law") {
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
    if (rawType === "tariff") {
      const p = rawP as {
        type: "tariff";
        scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
        targetSectorType?: OperatingSectorType;
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
    const lt = legislationTypeById.get(ltId);
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
    if (resetLegislationV2) {
      const resetTax = resetTaxesFor(sourceCountry as ResetCountry, "national").find(
        (candidate) => candidate.existingLegislationTypeId === lt._id
      );
      if (!resetTax) {
        return {
          ok: false,
          status: 409,
          error: "This world accepts only reviewed legislation v2 provisions.",
        };
      }
      if (resetTaxTypeIds.has(lt._id)) {
        return { ok: false, status: 400, error: "A v2 bill cannot repeat a tax instrument." };
      }
      if (category !== "tax" && category !== "custom") {
        return {
          ok: false,
          status: 400,
          error: "Reviewed tax provisions require a tax or multi-domain bill.",
        };
      }
      const resolved = await resolveResetTaxProvisionFields(
        db,
        lt,
        p?.proposedRate,
        typeof p?.policyOptionId === "string" ? p.policyOptionId : undefined,
        sourceCountry as ResetCountry,
        "national"
      );
      if (!resolved.ok) {
        return { ok: false, status: 400, error: resolved.error };
      }
      resetTaxTypeIds.add(lt._id);
      validatedPolicyProvisions.push({
        legislationTypeId: lt._id,
        ...resolved.fields,
      });
      continue;
    }
    if (sourceCountry === "US" && lt._id === "us_media_communications") {
      const mediaRegulationEnabled =
        mediaRegulation.enabled && marketAtLeast(mediaRegulation.marketSystemMode, "clearing");
      if (
        mediaRegulationEnabled &&
        !isMediaOwnershipBillAvailable(
          await loadUSMediaOutletDelivery(db, {
            currentTurn,
            currentYear: eraYear,
            commandEconomyEnabled: mediaRegulation.commandEconomyEnabled,
            includeSettledPolitical: true,
          })
        )
      ) {
        return {
          ok: false,
          status: 400,
          error:
            "Media ownership legislation is available only after measured outlet concentration exceeds 65%.",
        };
      }
    }
    if (!allowedDomains.includes(lt.policyDomain)) {
      return {
        ok: false,
        status: 400,
        error: `Legislation type "${lt.name}" is not in the selected category (${category}).`,
      };
    }
    validatedLegislationTypes.push(lt);

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

  const administrationValidation = validateBillAdministration({
    enabled: administration?.enabled === true,
    legislationTypes: validatedLegislationTypes,
  });
  if (!administrationValidation.ok) {
    return {
      ok: false,
      status: 400,
      error: administrationValidation.error ?? "Invalid administration metadata.",
    };
  }

  if (administration?.enabled === true && sourceCountry && validatedLegislationTypes.length > 0) {
    const conflict = await findAdministrationConflict(db, sourceCountry, validatedLegislationTypes);
    if (conflict) {
      return {
        ok: false,
        status: 409,
        error: `This bill conflicts with active law ${conflict.existingLegislationTypeId} through ${conflict.conflictSetId}. Repeal or replace that regime first.`,
      };
    }
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
    economicSystemReformProvisions: validatedEconomicSystemReformProvisions,
    euroAdoptionProvisions: validatedEuroAdoptionProvisions,
    europeanTreatyProvisions: validatedEuropeanTreatyProvisions,
    resetLawProvisions: validatedResetLawProvisions,
  };
}
