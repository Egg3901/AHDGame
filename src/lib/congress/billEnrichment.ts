import { describeElectoralLaw } from "@/lib/elections/electoralLaws";
import { warGoalLabel } from "@/lib/military/warGoals";
import type { Db } from "mongodb";
import { getPartyHex, formatBillPositionLabel } from "@/lib/utils/politics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  billHasDeclareWar,
  billHasNatPrivProvision,
  getBillPassRule,
} from "@/lib/congress/billPassRule";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";
import type { VoteByParty } from "./billVoting";
import type { OverrideChamberDisplay } from "./vetoOverrideTally";
import type {
  Bill,
  EndSubsidyProvision,
  LegislationPolicyOption,
  LegislationType,
  PoliticalParty,
  StatePolicy,
  SubsidyProvision,
  TariffProvision,
} from "@/lib/db/types";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { effectTargetLabelFromMetricId } from "@/lib/legislature/metricLabels";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { FederalBudget } from "@/lib/db/types/budget";
import { computeLawCost, type FiscalBase } from "@/lib/politicalLegislation/costEngine";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { countryFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { TAX_BASE_KEY } from "@/lib/politicalLegislation/estimates";
import { isNewGenerationType } from "@/lib/politicalLegislation/project";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import { computeProvisionEffectChips } from "@/lib/legislature/provisionEffects";
import { optionIntensity } from "@/lib/legislature/optionIntensity";
import { formatEmbargoProvisionLabel } from "@/lib/legislature/embargoProvisionLabel";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
  humanizeLegislationTypeId,
} from "@/lib/legislationTypeAliases";
import type { BillWhipPanelData } from "./billWhipPanelData";
import {
  billRequiresExecutiveAction,
  getInternationalActionDetail,
  getInternationalActionLabel,
  getInternationalActionSummary,
} from "@/lib/internationalOrganizations/withdrawalBills";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";
import {
  computeNationalizationProvisionDetail,
  type NationalizationProvisionDetail,
} from "@/lib/nationalization/billTargetPreview";
import { resolveActualPayoutLocal } from "@/lib/nationalization/ledger";
import { SECTOR_SCOPE_LABELS, type SectorScope } from "@/lib/nationalization/sectorScope";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";

// Re-exported from billTargetPreview (the shared SSOT) for existing importers.
export type { NationalizationProvisionDetail };

/**
 * One projected-effect chip on the bill detail page. `direction` is the way the
 * metric's VALUE moves when switching from the current law to the proposed one
 * (a delta, not the absolute push), and `isGood` is whether that movement is
 * beneficial given the metric's polarity. Computed via the shared
 * {@link pushesValueUp} helper so it stays consistent with the metric detail page.
 */
export interface BillProvisionEffect {
  metric: string;
  direction: "up" | "down";
  isGood: boolean;
}

export interface BillDetailProvision {
  legislationTypeName: string;
  policyOptionId?: string;
  policyOptionName?: string;
  currentPolicyOptionName?: string;
  /** "up" = raising/increasing from current, "down" = lowering, "same" = no change */
  changeDirection?: "up" | "down" | "same";
  effectDirection: number;
  directionLabel: "Left" | "Center" | "Right";
  positionLabel?: string;
  effectTargetLabel?: string;
  /**
   * Per-metric projected effects (for effect chips), each carrying its own
   * direction/polarity as a delta vs the current law.
   */
  effects?: BillProvisionEffect[];
  /** Per-archetype approval impacts (-100..+100) for the proposed option (static, often empty). */
  archetypeApprovals?: Record<string, number>;
  /** Shift-based archetype-approval inputs (policy domain + current/proposed option indices). */
  policyDomain?: string;
  currentPolicyIndex?: number;
  proposedPolicyIndex?: number;
  economic?: number;
  social?: number;
  /** Only present on `nationalize` provisions. */
  nationalizationDetail?: NationalizationProvisionDetail;
  /**
   * Political-legislation v2 (spec §8): live fiscal profile of the proposal
   * NEXT TO the current law's, with the net delta. Program laws carry
   * proposed/current/netDelta; tax sliders carry the rate move + revenue delta.
   */
  fiscal?: {
    currencyCode: string;
    proposed?: { cost: number; revenue: number; net: number };
    current?: { cost: number; revenue: number; net: number };
    netDelta?: number;
    currentRate?: number;
    proposedRate?: number;
    revenueDelta?: number;
  };
}

export interface EnrichedBillDetail {
  id: string;
  /** Resolved country (persisted on bill or derived from state / pseudo-state). */
  countryId: CountryId;
  /** Plain-language passage requirement (two-thirds for nat/priv in free legislatures). */
  passRule?: { rule: "majority" | "twoThirds"; label: string };
  title: string;
  summary: string;
  adminProposed?: boolean;
  fullText: string | null;
  stateId: string | null;
  originChamber: string;
  currentChamber: string;
  sponsorId: string | null;
  sponsorSequentialId?: number;
  sponsorName: string;
  sponsorParty: string;
  sponsorPartyName: string;
  sponsorPartyColor: string;
  coSponsors: Array<{ characterId: string; sequentialId?: number; characterName: string }>;
  status: string;
  category: string;
  legislationTypeId: string | null;
  legislationTypeName: string | null;
  effectDirection: number | null;
  directionLabel: "Left" | "Center" | "Right" | null;
  positionLabel: string | null;
  effectTargetLabel: string | null;
  provisions?: BillDetailProvision[];
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  totalVotes: number;
  otherChamberVotesFor: number;
  otherChamberVotesAgainst: number;
  otherChamberVotesAbstain: number;
  myVote: string | null;
  myOtherChamberVote: string | null;
  /** Pre-whip value if the authenticated character was Player-Whipped on this bill. */
  myWhippedFrom: string | null;
  /** Pre-whip value for the other chamber when applicable. */
  myOtherChamberWhippedFrom: string | null;
  /** Pre-whip value for a veto-override whip when applicable. */
  myOverrideWhippedFrom: string | null;
  canVoteOrigin: boolean;
  canVoteOther: boolean;
  canCosponsor: boolean;
  /** True when the viewer is listed as a co-sponsor and may remove that endorsement. */
  canUncosponsor: boolean;
  canWithdraw: boolean;
  canPresidentialAction: boolean;
  requiresExecutiveAction: boolean;
  vetoOverrideVotesFor: number;
  vetoOverrideVotesAgainst: number;
  // Per-chamber seat-weighted override tallies, computed authoritatively at read
  // time (US bicameral only; null for other countries / non-override bills). An
  // override needs 2/3 of each chamber's SEATS — see [[vetoOverrideTally]].
  overrideHouseFor: number | null;
  overrideHouseSeats: number | null;
  overrideSenateFor: number | null;
  overrideSenateSeats: number | null;
  overrideVotingEndsAt: string | null;
  overrideVotingEndsOnTurn: number | null;
  overrideEnactedAt: string | null;
  overrideFailedAt: string | null;
  myOverrideVote: string | null;
  canVetoOverride: boolean;
  proposedAt: string;
  votingStartedAt: string | null;
  votingEndsAt: string | null;
  votingEndsOnTurn: number | null;
  passedOriginAt: string | null;
  sentToOtherChamberAt: string | null;
  otherChamberVotingStartedAt: string | null;
  otherChamberVotingEndsAt: string | null;
  otherChamberVotingEndsOnTurn: number | null;
  passedOtherChamberAt: string | null;
  sentToPresidentAt: string | null;
  presidentActionDeadline: string | null;
  presidentActionDeadlineOnTurn: number | null;
  presidentAction: string | null;
  vetoMessage: string | null;
  enactedAt: string | null;
  failedAt: string | null;
  voteByPartyOrigin?: VoteByParty[];
  voteByPartyOther?: VoteByParty[];
  canCommitteeDelay: boolean;
  /** Filibuster invocations — present when the bill has been filibustered in the Senate. */
  filibusterInvocations?: {
    characterId: string;
    sequentialId?: number;
    characterName: string;
    invokedAt: string;
  }[];
  /** True when the viewer is a US Senator who has not yet filibustered this bill and filibuster is available. */
  canFilibuster: boolean;
  whipPanel: BillWhipPanelData | null;
}

export function directionLabel(d: number): "Left" | "Center" | "Right" {
  if (d < 0) return "Left";
  if (d > 0) return "Right";
  return "Center";
}

// Re-exported (kept importable from this module for existing call sites).
export { effectTargetLabelFromMetricId };

function sumVoteByParty(voteByParty: VoteByParty[]): {
  for: number;
  against: number;
  abstain: number;
} | null {
  if (voteByParty.length === 0) return null;
  return voteByParty.reduce(
    (totals, party) => ({
      for: totals.for + party.for,
      against: totals.against + party.against,
      abstain: totals.abstain + party.abstain,
    }),
    { for: 0, against: 0, abstain: 0 }
  );
}

/**
 * Check if a legislation type actually uses an axis.
 * An axis is relevant if ANY policy option has a non-zero value for it.
 * If all options are 0, the axis is not relevant (null) and shouldn't display.
 */
export function axisRelevant(
  lt: LegislationType | null | undefined,
  axis: "economic" | "social"
): boolean {
  if (!lt?.policyOptions?.length) return false;
  return lt.policyOptions.some((opt) => (opt[axis] ?? 0) !== 0);
}

function formatPolicyOptionLabel(option: LegislationPolicyOption): string {
  if (option.explanation?.includes(": ")) return option.explanation;
  if (option.explanation) return `${option.name}: ${option.explanation}`;
  return option.name;
}

function resolveProvisionPolicyOption(
  lt: LegislationType | null | undefined,
  provision: {
    policyOptionId?: string;
    economic?: number;
    social?: number;
    effectDirection: number;
  }
): { option: LegislationPolicyOption; index: number } | null {
  if (!lt?.policyOptions?.length) return null;

  if (provision.policyOptionId) {
    const optionIndex = lt.policyOptions.findIndex((opt) => opt.id === provision.policyOptionId);
    if (optionIndex !== -1) {
      return { option: lt.policyOptions[optionIndex], index: optionIndex };
    }
  }

  const hasExplicitAxes = provision.economic != null || provision.social != null;
  if (hasExplicitAxes) {
    const optionIndex = lt.policyOptions.findIndex(
      (opt) =>
        (opt.economic ?? 0) === (provision.economic ?? 0) &&
        (opt.social ?? 0) === (provision.social ?? 0)
    );
    if (optionIndex !== -1) {
      return { option: lt.policyOptions[optionIndex], index: optionIndex };
    }
  }

  const directionMatches = lt.policyOptions
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => option.effectDirection === provision.effectDirection);
  if (directionMatches.length === 1) return directionMatches[0];

  return null;
}

function formatCountryName(countryId?: string): string {
  if (!countryId) return "selected country";
  return COUNTRY_CONFIGS[countryId as CountryId]?.name ?? countryId;
}

function formatSectorTypeLabel(sectorType?: string): string {
  if (!sectorType) return "selected sector";
  return sectorType.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTariffProvisionLabel(provision: TariffProvision): string {
  const rateLabel = `${provision.rate}% tariff`;
  switch (provision.scopeType) {
    case "economy_wide":
      return `${rateLabel} on all imports`;
    case "sector":
      return `${rateLabel} on ${formatSectorTypeLabel(provision.targetSectorType)} imports`;
    case "origin_country":
      return `${rateLabel} on imports from ${formatCountryName(provision.targetOriginCountryId)}`;
    case "corporation":
      return `${rateLabel} on a targeted corporation`;
    default:
      return rateLabel;
  }
}

export function formatSubsidyProvisionLabel(provision: SubsidyProvision | EndSubsidyProvision): {
  legislationTypeName: string;
  policyOptionName: string;
} {
  const scopeLabel =
    provision.scopeType === "economy_wide"
      ? "economy-wide"
      : `${formatSectorTypeLabel(provision.targetSectorType)} sector`;
  const strategyLabel = provision.targetStrategyId ? ` (${provision.targetStrategyId})` : "";

  if (provision.type === "end_subsidy") {
    return {
      legislationTypeName: "Subsidy Repeal",
      policyOptionName: `End subsidies for the ${scopeLabel}${strategyLabel}`,
    };
  }

  return {
    legislationTypeName: "Subsidy",
    policyOptionName: `Grant subsidies to the ${scopeLabel}${strategyLabel}${provision.domesticOnly ? " (domestic only)" : ""}`,
  };
}

type CurrentPolicySnapshot = {
  policyOptionId?: string;
  policyOptionIndex?: number;
};

/**
 * Resolves bill provisions by fetching legislation types and formatting.
 */
/**
 * Political-legislation v2 (spec §8): the proposed level's fiscal profile next
 * to the current law's, priced live on the country rollup (voters see what the
 * CHANGE costs). Tax sliders report the rate move + revenue delta instead.
 * Returns {} for old-generation types — zero payload change for them.
 */
async function resolveProvisionFiscal(
  db: Db,
  bill: Bill,
  lt: LegislationType | null | undefined,
  prov: { proposedRate?: number },
  proposedOptionIndex: number | undefined,
  currentIndex: number | undefined
): Promise<{ fiscal?: NonNullable<BillDetailProvision["fiscal"]> }> {
  if (!lt || !isNewGenerationType(lt)) return {};
  const countryId = (bill.countryId ?? "US") as LawCountryId;
  if (!(countryId in COST_INCOME_ANCHORS)) return {};
  const currencyCode = COUNTRY_CURRENCY_MAP[countryId];

  if (lt.taxSlider) {
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne(
        { _id: getNationalBudgetId(countryId) },
        { projection: { taxRates: 1, taxBases: 1 } }
      );
    const currentRate =
      (budget?.taxRates as Record<string, number> | undefined)?.[lt.taxSlider.taxType] ??
      lt.taxSlider.baselineRate;
    const proposedRate = prov.proposedRate;
    if (proposedRate === undefined) return {};
    const baseKey = TAX_BASE_KEY[lt.taxSlider.taxType];
    const taxBase = baseKey ? (budget?.taxBases?.[baseKey] ?? 0) : 0;
    return {
      fiscal: {
        currencyCode,
        currentRate,
        proposedRate,
        revenueDelta: ((proposedRate - currentRate) * taxBase) / 100,
      },
    };
  }

  if (proposedOptionIndex === undefined) return {};
  const base: FiscalBase = await countryFiscalBase(db, countryId);
  const priceLevel = (index: number) => {
    const model = lt.policyOptions?.[index]?.costModelV2 ?? {};
    const { cost, revenue, net } = computeLawCost(
      { name: "", description: "", ...model },
      base,
      countryId,
      null
    );
    return { cost, revenue, net };
  };
  const proposed = priceLevel(proposedOptionIndex);
  const current = currentIndex !== undefined ? priceLevel(currentIndex) : undefined;
  return {
    fiscal: {
      currencyCode,
      proposed,
      ...(current && { current }),
      netDelta: proposed.net - (current?.net ?? 0),
    },
  };
}

export async function resolveBillProvisions(
  db: Db,
  bill: Bill
): Promise<{
  provisionsResolved: BillDetailProvision[];
  legislationTypeName: string | null;
  legacyDirectionLabel: "Left" | "Center" | "Right" | null;
  legacyEffectTargetLabel: string | null;
}> {
  const provisionsResolved: BillDetailProvision[] = [];
  let legislationTypeName: string | null = null;
  let legacyDirectionLabel: "Left" | "Center" | "Right" | null = null;
  let legacyEffectTargetLabel: string | null = null;

  if (bill.provisions?.length) {
    const policyProvisions = bill.provisions.filter(isPolicyProvision);
    const canonicalLegTypeIds = [
      ...new Set(
        policyProvisions
          .map((p) => canonicalizeLegislationTypeId(p.legislationTypeId))
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const legTypeIds = [
      ...new Set(canonicalLegTypeIds.flatMap((id) => getEquivalentLegislationTypeIds(id))),
    ];
    const legislationTypes = legTypeIds.length
      ? await db
          .collection<LegislationType>("legislationTypes")
          .find({ _id: { $in: legTypeIds } })
          .toArray()
      : [];
    const legislationTypeMap = new Map<string, LegislationType>();
    for (const lt of legislationTypes) {
      const canonicalId = canonicalizeLegislationTypeId(lt._id);
      if (!canonicalId) continue;
      if (!legislationTypeMap.has(canonicalId) || lt._id === canonicalId) {
        legislationTypeMap.set(canonicalId, lt);
      }
    }

    // Resolve the national-scope stateId from the bill's country (e.g. "federal" for US, "uk_national" for UK)
    const nationalStateId = bill.countryId
      ? (getNationalDocId(bill.countryId) ?? `${bill.countryId.toLowerCase()}_national`)
      : (bill.stateId ?? "federal");
    const currentPolicies = await db
      .collection<StatePolicy>("statePolicies")
      .find({ stateId: nationalStateId, legislationTypeId: { $in: legTypeIds } })
      .toArray();
    const currentPolicyMap = new Map<string, CurrentPolicySnapshot>();
    for (const currentPolicy of currentPolicies) {
      const canonicalId = canonicalizeLegislationTypeId(currentPolicy.legislationTypeId);
      if (!canonicalId) continue;
      if (!currentPolicyMap.has(canonicalId) || currentPolicy.legislationTypeId === canonicalId) {
        currentPolicyMap.set(canonicalId, currentPolicy);
      }
    }

    // Fallback: for types missing from statePolicies, check enacted laws for the active option index
    const missingLegTypeIds = canonicalLegTypeIds.filter((id) => !currentPolicyMap.has(id));
    if (missingLegTypeIds.length > 0) {
      const countryId = bill.countryId ?? (inferCountryIdFromStateId(nationalStateId) as string);
      const enactedLaws = await db
        .collection<EnactedLaw>("enactedLaws")
        .find({
          legislationTypeId: {
            $in: missingLegTypeIds.flatMap((id) => getEquivalentLegislationTypeIds(id)),
          },
          countryId,
          repealedAt: { $exists: false },
        })
        .sort({ enactedAt: -1 })
        .toArray();

      const seen = new Set<string>();
      for (const law of enactedLaws) {
        const canonicalId = canonicalizeLegislationTypeId(law.legislationTypeId);
        if (!canonicalId || seen.has(canonicalId)) continue;
        seen.add(canonicalId);
        if (law.policyOptionIndex !== undefined) {
          // Create a minimal entry so the enrichment logic can find the option index
          currentPolicyMap.set(canonicalId, {
            policyOptionIndex: law.policyOptionIndex,
          });
        }
      }
    }

    for (const provision of bill.provisions) {
      if (!isPolicyProvision(provision)) {
        if (provision.type === "tariff") {
          provisionsResolved.push({
            legislationTypeName: "Tariff",
            policyOptionName: formatTariffProvisionLabel(provision),
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "nationalize") {
          const policyOptionName = provision.targetSectorType
            ? `Sector takeover — ${CORPORATION_TYPE_LABELS[provision.targetSectorType as CorporationType] ?? provision.targetSectorType} · ${Math.round((provision.sectorCarveFraction ?? 1) * 100)}% · ${SECTOR_SCOPE_LABELS[(provision.sectorScope ?? "all") as SectorScope] ?? provision.sectorScope}`
            : provision.targetSectorId
              ? "Sector takeover"
              : "Whole-corporation takeover";

          // Prefer the snapshot frozen at enactment so a passed bill keeps showing
          // the affected-corp/treasury-cost breakdown as it was when it passed,
          // instead of recomputing to zero once the assets are taken. Fall back to a
          // live preview for proposed/pending bills (no snapshot yet). Best-effort:
          // a failure here must not break bill rendering.
          let nationalizationDetail: NationalizationProvisionDetail | undefined =
            provision.nationalizationSnapshot;
          const natCountryId = bill.countryId;
          if (!nationalizationDetail && natCountryId) {
            try {
              const currentTurn = await getCurrentTurn(db);
              nationalizationDetail = await computeNationalizationProvisionDetail(
                db,
                natCountryId,
                provision,
                currentTurn
              );
            } catch (err) {
              console.error("[billEnrichment] nationalization detail failed:", err);
            }
          }

          // Overlay the ACTUAL compensation paid (from the permanent ledger) so an
          // enacted bill shows the authoritative figure next to the estimate. The
          // ledger never zeroes out, so this works for past + future, immediate +
          // deferred takings. Best-effort; absent for proposed/pending bills.
          if (nationalizationDetail && natCountryId) {
            try {
              const currency =
                nationalizationDetail.kind === "sector"
                  ? nationalizationDetail.sector.currency
                  : nationalizationDetail.corp.currency;
              const actual = await resolveActualPayoutLocal(db, {
                countryId: natCountryId,
                currency,
                sectorType:
                  nationalizationDetail.kind === "sector" ? provision.targetSectorType : undefined,
                corpName:
                  nationalizationDetail.kind === "corp"
                    ? nationalizationDetail.corp.name
                    : undefined,
              });
              if (actual !== undefined) {
                nationalizationDetail = { ...nationalizationDetail, actualPayoutLocal: actual };
              }
            } catch (err) {
              console.error("[billEnrichment] actual payout lookup failed:", err);
            }
          }

          provisionsResolved.push({
            legislationTypeName: "Nationalization",
            policyOptionName,
            effectDirection: 0,
            directionLabel: "Center",
            ...(nationalizationDetail && { nationalizationDetail }),
          });
          continue;
        }

        if (provision.type === "privatize") {
          provisionsResolved.push({
            legislationTypeName: "Privatization",
            policyOptionName: `Spin out: ${provision.newCorpName}`,
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "designate_strategic_sector") {
          provisionsResolved.push({
            legislationTypeName: "Strategic-Sector Designation",
            policyOptionName: provision.sectorType,
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "embargo" || provision.type === "end_embargo") {
          const embargoLabel = formatEmbargoProvisionLabel(provision);
          provisionsResolved.push({
            legislationTypeName: embargoLabel.kind,
            // "Title: description" → split into proposed title + larp description.
            policyOptionName: `${embargoLabel.summary}: ${embargoLabel.description}`,
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "international_organization") {
          const kind =
            provision.subType === "join"
              ? "Join Organization"
              : provision.subType === "fund"
                ? "Fund Organization"
                : "Leave Organization";
          const detail =
            provision.subType === "fund" && provision.amountLocal
              ? `${provision.organizationName}: ${provision.amountLocal.toLocaleString()} (local)`
              : provision.organizationName;
          provisionsResolved.push({
            legislationTypeName: kind,
            policyOptionName: detail,
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "euro_adoption") {
          provisionsResolved.push({
            legislationTypeName: "Currency Adoption",
            policyOptionName: "Adopt shared currency",
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "union_law") {
          provisionsResolved.push({
            legislationTypeName: "Union Law",
            policyOptionName:
              provision.banAction === "ban"
                ? "Ban unions nationally"
                : provision.banAction === "repeal_ban"
                  ? "Repeal the union ban"
                  : provision.bias > 0
                    ? `Collective-bargaining strength: +${provision.bias}`
                    : provision.bias < 0
                      ? `Right-to-work strength: ${provision.bias}`
                      : "Neutral",
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "electoral_law") {
          provisionsResolved.push({
            legislationTypeName: "Electoral Law",
            policyOptionName: describeElectoralLaw(provision),
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "central_bank_independence") {
          provisionsResolved.push({
            legislationTypeName: "Central Bank Independence",
            policyOptionName:
              provision.action === "grant"
                ? "Grant the central bank operational independence"
                : "Return rate-setting to the government",
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        // Must sit ABOVE the subsidy fallback: that call is a catch-all, so a
        // declaration would otherwise be formatted as a subsidy.
        if (provision.type === "declare_war") {
          provisionsResolved.push({
            legislationTypeName: "Declaration of War",
            policyOptionName: `${provision.targetCountry} · ${warGoalLabel(provision.warGoal)}`,
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        const subsidyProvision = formatSubsidyProvisionLabel(provision);
        provisionsResolved.push({
          legislationTypeName: subsidyProvision.legislationTypeName,
          policyOptionName: subsidyProvision.policyOptionName,
          effectDirection: 0,
          directionLabel: "Center",
        });
        continue;
      }

      const canonicalLegislationTypeId = canonicalizeLegislationTypeId(provision.legislationTypeId);
      const lt = canonicalLegislationTypeId
        ? legislationTypeMap.get(canonicalLegislationTypeId)
        : null;
      const prov = provision as {
        effectDirection: number;
        policyOptionId?: string;
        policyOptionNameSnapshot?: string;
        currentPolicyOptionIdSnapshot?: string;
        currentPolicyOptionNameSnapshot?: string;
        economic?: number;
        social?: number;
        proposedRate?: number;
      };
      const posLabel =
        prov.economic != null || prov.social != null
          ? formatBillPositionLabel(prov.economic, prov.social)
          : undefined;

      const resolvedOption = resolveProvisionPolicyOption(lt, prov);
      const policyOptionName =
        prov.policyOptionNameSnapshot ??
        (resolvedOption
          ? formatPolicyOptionLabel(resolvedOption.option)
          : (posLabel ?? `${directionLabel(prov.effectDirection)} policy`));
      const proposedOptionIndex = resolvedOption?.index;

      // Calculate change direction and current policy option name
      let changeDirection: "up" | "down" | "same" | undefined;
      let currentPolicyOptionName: string | undefined = prov.currentPolicyOptionNameSnapshot;
      let currentIndex: number | undefined;
      if (lt?.policyOptions?.length) {
        if (prov.currentPolicyOptionIdSnapshot) {
          const optionIndex = lt.policyOptions.findIndex(
            (opt) => opt.id === prov.currentPolicyOptionIdSnapshot
          );
          if (optionIndex !== -1) currentIndex = optionIndex;
        } else {
          const currentPolicy = canonicalLegislationTypeId
            ? currentPolicyMap.get(canonicalLegislationTypeId)
            : undefined;
          if (typeof currentPolicy?.policyOptionIndex === "number") {
            currentIndex = currentPolicy.policyOptionIndex;
          } else if (currentPolicy?.policyOptionId) {
            const optionIndex = lt.policyOptions.findIndex(
              (opt) => opt.id === currentPolicy.policyOptionId
            );
            if (optionIndex !== -1) currentIndex = optionIndex;
          }
        }

        if (!currentPolicyOptionName && currentIndex !== undefined) {
          const currentOpt = lt.policyOptions[currentIndex];
          if (currentOpt) currentPolicyOptionName = formatPolicyOptionLabel(currentOpt);
        }
        if (proposedOptionIndex !== undefined && currentIndex !== undefined) {
          if (proposedOptionIndex > currentIndex) {
            changeDirection = "up";
          } else if (proposedOptionIndex < currentIndex) {
            changeDirection = "down";
          } else {
            changeDirection = "same";
          }
        }
      }

      // Per-metric DELTA: how each metric moves switching from current law to
      // proposed, using GRADED option intensity (Bug #0962) so a same-side change of
      // intensity still shows chips. Falls back to the effectDirection sign when the
      // option can't be resolved. Shared with the state bill page via
      // computeProvisionEffectChips so the two stay in lockstep.
      const provOptions = lt?.policyOptions ?? [];
      const proposedIntensity =
        proposedOptionIndex !== undefined
          ? optionIntensity(provOptions, proposedOptionIndex)
          : Math.sign(prov.effectDirection);
      const currentIntensity =
        currentIndex !== undefined ? optionIntensity(provOptions, currentIndex) : 0;
      const effectMetrics = computeProvisionEffectChips({
        // The headline-effectTarget fallback synthesizes weight +1, which
        // flips the displayed sign for laws whose real (removed) weighted
        // entry was negative — and mirror-owned metrics never move from
        // legislation anyway, so never synthesize a chip for them (same
        // filter nationalPolicyRecords applies).
        effectTargetsWeighted: lt?.effectTargetsWeighted?.length
          ? lt.effectTargetsWeighted
          : lt?.effectTarget?.metricId &&
              !MIRROR_CONTROLLED_METRIC_IDS.has(lt.effectTarget.metricId)
            ? [
                {
                  metricCategoryId: lt.effectTarget.metricCategoryId,
                  metricId: lt.effectTarget.metricId,
                  weight: 1,
                },
              ]
            : [],
        proposedIntensity,
        currentIntensity,
      });

      provisionsResolved.push({
        legislationTypeName:
          lt?.name ??
          humanizeLegislationTypeId(provision.legislationTypeId) ??
          provision.legislationTypeId,
        ...(prov.policyOptionId && { policyOptionId: prov.policyOptionId }),
        policyOptionName,
        ...(currentPolicyOptionName && { currentPolicyOptionName }),
        ...(changeDirection && { changeDirection }),
        effectDirection: provision.effectDirection,
        directionLabel: directionLabel(provision.effectDirection),
        ...(posLabel && { positionLabel: posLabel }),
        effectTargetLabel: lt?.effectTarget?.metricId
          ? effectTargetLabelFromMetricId(lt.effectTarget.metricId)
          : undefined,
        ...(effectMetrics.length && { effects: effectMetrics }),
        ...(resolvedOption?.option.archetypeApprovals &&
          Object.keys(resolvedOption.option.archetypeApprovals).length > 0 && {
            archetypeApprovals: resolvedOption.option.archetypeApprovals,
          }),
        ...(lt?.policyDomain && { policyDomain: lt.policyDomain }),
        ...(currentIndex !== undefined && { currentPolicyIndex: currentIndex }),
        ...(proposedOptionIndex !== undefined && { proposedPolicyIndex: proposedOptionIndex }),
        ...(lt?.policyOptions?.length && {
          policyOptionScores: lt.policyOptions.map((o) => (o.economic ?? 0) + (o.social ?? 0)),
        }),
        ...(prov.economic != null && axisRelevant(lt, "economic") && { economic: prov.economic }),
        ...(prov.social != null && axisRelevant(lt, "social") && { social: prov.social }),
        ...(await resolveProvisionFiscal(db, bill, lt, prov, proposedOptionIndex, currentIndex)),
      });
    }
  }

  if (bill.legislationTypeId && !bill.provisions?.length) {
    const lt = await db.collection<LegislationType>("legislationTypes").findOne({
      _id: { $in: getEquivalentLegislationTypeIds(bill.legislationTypeId) },
    });
    legislationTypeName = lt?.name ?? humanizeLegislationTypeId(bill.legislationTypeId) ?? null;
    const d = bill.effectDirection ?? null;
    legacyDirectionLabel = d != null ? directionLabel(d) : null;
    legacyEffectTargetLabel = lt?.effectTarget?.metricId
      ? effectTargetLabelFromMetricId(lt.effectTarget.metricId)
      : null;
  }

  if (bill.internationalAction && !bill.provisions?.length && !bill.legislationTypeId) {
    const label = getInternationalActionLabel(bill.internationalAction);
    const summary = getInternationalActionSummary(bill.internationalAction);
    const detail = getInternationalActionDetail(bill.internationalAction);

    provisionsResolved.push({
      legislationTypeName: label,
      policyOptionName: summary,
      currentPolicyOptionName: detail,
      effectDirection: 0,
      directionLabel: "Center",
    });
    legislationTypeName = label;
    legacyEffectTargetLabel = detail;
  }

  return {
    provisionsResolved,
    legislationTypeName,
    legacyDirectionLabel,
    legacyEffectTargetLabel,
  };
}

/**
 * Transforms a Bill database record into an enriched detail object for the API.
 */
export function billToDetail(
  bill: Bill,
  resolvedCountryId: CountryId,
  partyMap: Map<string, PoliticalParty>,
  legislationTypeName: string | null,
  provisionsResolved: BillDetailProvision[],
  legacyDirectionLabel: "Left" | "Center" | "Right" | null,
  legacyEffectTargetLabel: string | null,
  myCharacterId: string | null,
  isHouseMember: boolean,
  isSenateMember: boolean,
  isPresident: boolean,
  voteByPartyOrigin: VoteByParty[],
  voteByPartyOther: VoteByParty[],
  whipPanel: BillWhipPanelData | null = null,
  sequentialIdMap: Map<string, number> = new Map(),
  canCabinetVote: boolean = false,
  /** Lower chamber key for this bill's country (e.g. "house", "commons") */
  lowerChamberKey: string = "house",
  /** Upper chamber key (e.g. "senate", "lords"), null if no elected upper chamber */
  upperChamberKey: string | null = "senate",
  /**
   * Per-chamber seat-weighted override result, recomputed authoritatively from the
   * current seat holders. Null for non-override / non-bicameral bills.
   */
  overrideDisplay: OverrideChamberDisplay | null = null
): EnrichedBillDetail {
  const partySlug = bill.sponsorParty ?? "";
  const party = partyMap.get(partySlug);
  const origin = bill.originChamber;
  const current = bill.currentChamber;

  // JP "override_shugiin" reuses the main votes/votingEndsAt fields and is voted
  // on in the Shūgiin only — same shape as `active`, just a different status.
  const inOriginVote = bill.status === "active" || bill.status === "override_shugiin";
  const inOtherVote = bill.status === "active_other";
  const inCabinetReview = bill.status === "cabinet_review";

  // isHouseMember = lower chamber member, isSenateMember = upper chamber member
  const currentChamberType = current === "joint" ? lowerChamberKey : current;
  const isInCurrentChamber =
    (currentChamberType === lowerChamberKey && isHouseMember) ||
    (upperChamberKey != null && currentChamberType === upperChamberKey && isSenateMember);

  const canVoteOrigin = inCabinetReview
    ? canCabinetVote && myCharacterId != null && !bill.votes?.[myCharacterId]
    : inOriginVote && isInCurrentChamber;
  const canVoteOther = inOtherVote && isInCurrentChamber;
  const originTotals = sumVoteByParty(voteByPartyOrigin) ?? {
    for: bill.votesFor,
    against: bill.votesAgainst,
    abstain: bill.votesAbstain,
  };
  const otherTotals = sumVoteByParty(voteByPartyOther) ?? {
    for: bill.otherChamberVotesFor ?? 0,
    against: bill.otherChamberVotesAgainst ?? 0,
    abstain: bill.otherChamberVotesAbstain ?? 0,
  };

  return {
    id: bill._id.toString(),
    countryId: resolvedCountryId,
    passRule: getBillPassRule(
      COUNTRY_CONFIGS[resolvedCountryId]?.governmentType,
      billHasNatPrivProvision(bill.provisions),
      billHasDeclareWar(bill.provisions)
    ),
    title: bill.title,
    summary: bill.summary,
    ...(bill.adminProposed ? { adminProposed: true } : {}),
    fullText: bill.fullText ?? null,
    stateId: bill.stateId ?? null,
    originChamber: origin,
    currentChamber: current,
    sponsorId: bill.sponsorId?.toString() ?? null,
    sponsorSequentialId: bill.sponsorId
      ? sequentialIdMap.get(bill.sponsorId.toString())
      : undefined,
    sponsorName: bill.sponsorName,
    sponsorParty: partySlug,
    sponsorPartyName: party?.name ?? (partySlug || "Independent"),
    sponsorPartyColor: getPartyHex(partySlug, party?.color),
    coSponsors: (bill.coSponsors ?? []).map((cs) => ({
      characterId: cs.characterId.toString(),
      sequentialId: sequentialIdMap.get(cs.characterId.toString()),
      characterName: cs.characterName,
    })),
    status: bill.status,
    category: bill.category ?? "general",
    legislationTypeId: bill.legislationTypeId ?? null,
    legislationTypeName: bill.legislationTypeId ? legislationTypeName : null,
    effectDirection: bill.effectDirection ?? null,
    directionLabel: legacyDirectionLabel,
    positionLabel: provisionsResolved[0]?.positionLabel ?? null,
    effectTargetLabel: legacyEffectTargetLabel,
    provisions: provisionsResolved.length ? provisionsResolved : undefined,
    // Origin chamber
    votesFor: originTotals.for,
    votesAgainst: originTotals.against,
    votesAbstain: originTotals.abstain,
    totalVotes: originTotals.for + originTotals.against + originTotals.abstain,
    // Other chamber
    otherChamberVotesFor: otherTotals.for,
    otherChamberVotesAgainst: otherTotals.against,
    otherChamberVotesAbstain: otherTotals.abstain,
    // My votes
    myVote: myCharacterId ? (bill.votes?.[myCharacterId] ?? null) : null,
    myOtherChamberVote: myCharacterId ? (bill.otherChamberVotes?.[myCharacterId] ?? null) : null,
    // Player-Whip snapshots for the authenticated character only
    myWhippedFrom: myCharacterId ? (bill.whippedFromVote?.[myCharacterId] ?? null) : null,
    myOtherChamberWhippedFrom: myCharacterId
      ? (bill.otherChamberWhippedFromVote?.[myCharacterId] ?? null)
      : null,
    myOverrideWhippedFrom: myCharacterId
      ? (bill.vetoOverrideWhippedFromVote?.[myCharacterId] ?? null)
      : null,
    // Permissions
    canVoteOrigin,
    canVoteOther,
    canCosponsor:
      !!myCharacterId &&
      (isHouseMember || isSenateMember) &&
      bill.sponsorId?.toString() !== myCharacterId &&
      !(bill.coSponsors ?? []).some((cs) => cs.characterId.toString() === myCharacterId) &&
      ["active", "proposed"].includes(bill.status),
    canUncosponsor:
      !!myCharacterId &&
      (bill.coSponsors ?? []).some((cs) => cs.characterId.toString() === myCharacterId) &&
      ["active", "proposed"].includes(bill.status),
    canWithdraw: bill.sponsorId?.toString() === myCharacterId && bill.status === "proposed",
    canPresidentialAction: isPresident && bill.status === "enrolled",
    requiresExecutiveAction: billRequiresExecutiveAction(bill),
    // Veto override
    vetoOverrideVotesFor: bill.vetoOverrideVotesFor ?? 0,
    vetoOverrideVotesAgainst: bill.vetoOverrideVotesAgainst ?? 0,
    overrideHouseFor: overrideDisplay?.house.for ?? null,
    overrideHouseSeats: overrideDisplay?.house.seats ?? null,
    overrideSenateFor: overrideDisplay?.senate.for ?? null,
    overrideSenateSeats: overrideDisplay?.senate.seats ?? null,
    overrideVotingEndsAt: bill.overrideVotingEndsAt?.toISOString() ?? null,
    overrideVotingEndsOnTurn: bill.overrideVotingEndsOnTurn ?? null,
    overrideEnactedAt: bill.overrideEnactedAt?.toISOString() ?? null,
    overrideFailedAt: bill.overrideFailedAt?.toISOString() ?? null,
    myOverrideVote: myCharacterId ? (bill.vetoOverrideVotes?.[myCharacterId] ?? null) : null,
    canVetoOverride: bill.status === "veto_override" && (isHouseMember || isSenateMember),
    // Timeline
    proposedAt: bill.proposedAt.toISOString(),
    votingStartedAt: bill.votingStartedAt?.toISOString() ?? null,
    votingEndsAt: bill.votingEndsAt?.toISOString() ?? null,
    votingEndsOnTurn: bill.votingEndsOnTurn ?? null,
    passedOriginAt: bill.passedOriginAt?.toISOString() ?? null,
    sentToOtherChamberAt: bill.sentToOtherChamberAt?.toISOString() ?? null,
    otherChamberVotingStartedAt: bill.otherChamberVotingStartedAt?.toISOString() ?? null,
    otherChamberVotingEndsAt: bill.otherChamberVotingEndsAt?.toISOString() ?? null,
    otherChamberVotingEndsOnTurn: bill.otherChamberVotingEndsOnTurn ?? null,
    passedOtherChamberAt: bill.passedOtherChamberAt?.toISOString() ?? null,
    sentToPresidentAt: bill.sentToPresidentAt?.toISOString() ?? null,
    presidentActionDeadline: bill.presidentActionDeadline?.toISOString() ?? null,
    presidentActionDeadlineOnTurn: bill.presidentActionDeadlineOnTurn ?? null,
    presidentAction: bill.presidentAction ?? null,
    vetoMessage: bill.vetoMessage ?? null,
    enactedAt: bill.enactedAt?.toISOString() ?? null,
    failedAt: bill.failedAt?.toISOString() ?? null,
    voteByPartyOrigin: voteByPartyOrigin.length ? voteByPartyOrigin : undefined,
    voteByPartyOther: voteByPartyOther.length ? voteByPartyOther : undefined,
    canCommitteeDelay: false,
    // Filibuster
    filibusterInvocations: bill.filibusterInvocations?.map((inv) => ({
      characterId: inv.characterId,
      sequentialId: sequentialIdMap.get(inv.characterId),
      characterName: inv.characterName,
      invokedAt:
        inv.invokedAt instanceof Date ? inv.invokedAt.toISOString() : String(inv.invokedAt),
    })),
    canFilibuster:
      // Only US Senate bills in the Senate that are actively being voted on
      !!myCharacterId &&
      isSenateMember &&
      bill.currentChamber === "senate" &&
      (bill.status === "active" || bill.status === "active_other") &&
      // Senator hasn't already filibustered this bill
      !(bill.filibusterInvocations ?? []).some((inv) => inv.characterId === myCharacterId),
    whipPanel,
  };
}
