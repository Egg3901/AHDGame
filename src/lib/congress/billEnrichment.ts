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
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";
import type { VoteByParty } from "./billVoting";
import type { OverrideChamberDisplay } from "./vetoOverrideTally";
import type { VoteShiftPreview } from "@/lib/legislature/voteShiftPreview";
import type {
  Bill,
  CreateDepartmentProvision,
  EndSubsidyProvision,
  LegislationType,
  PoliticalParty,
  SubsidyProvision,
  TariffProvision,
} from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { effectTargetLabelFromMetricId } from "@/lib/legislature/metricLabels";
import {
  directionLabel,
  loadLiveCurrentPolicies,
  resolvePolicyProvision,
  type ProvisionDisplay,
  type SnapshottedProvision,
} from "@/lib/legislature/provisionEnrichment";
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

/**
 * One resolved provision on the national bill page.
 *
 * Now an alias of the shared {@link ProvisionDisplay}: the national and regional
 * pages emit the same shape so they cannot drift apart again. `changeDirection`
 * used to live here; it was computed, typed and plumbed but rendered nowhere, so
 * it was removed rather than carried across.
 */
export type BillDetailProvision = ProvisionDisplay;

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
  /** What the viewer's Aye and Nay would each do to their positions; null for spectators. */
  voteShiftPreview?: VoteShiftPreview | null;
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

// Re-exported (kept importable from this module for existing call sites).
export { directionLabel, effectTargetLabelFromMetricId };

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

/**
 * Human label for a `create_department` provision.
 *
 * Exists because the subsidy formatter below is the documented CATCH-ALL for
 * unrecognised provisions, so adding `CreateDepartmentProvision` to
 * `BillProvision` without a branch here silently routed department bills into
 * it. That is not only a type error: a bill creating the Department of
 * Education would have rendered with a subsidy label.
 *
 * The seat id is the only field the provision carries, so the label is derived
 * from it rather than from a lookup table that would need maintaining in
 * parallel with the roster.
 */
export function formatCreateDepartmentLabel(provision: CreateDepartmentProvision): {
  legislationTypeName: string;
  proposed: { name: string };
} {
  const seat = provision.positionId
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => (part === "of" ? "of" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
  return {
    legislationTypeName: "Executive Reorganization",
    proposed: { name: `Establish the office of ${seat}` },
  };
}

export function formatSubsidyProvisionLabel(provision: SubsidyProvision | EndSubsidyProvision): {
  legislationTypeName: string;
  proposed: { name: string };
} {
  const scopeLabel =
    provision.scopeType === "economy_wide"
      ? "economy-wide"
      : `${formatSectorTypeLabel(provision.targetSectorType)} sector`;
  const strategyLabel = provision.targetStrategyId ? ` (${provision.targetStrategyId})` : "";

  if (provision.type === "end_subsidy") {
    return {
      legislationTypeName: "Subsidy Repeal",
      proposed: { name: `End subsidies for the ${scopeLabel}${strategyLabel}` },
    };
  }

  return {
    legislationTypeName: "Subsidy",
    proposed: {
      name: `Grant subsidies to the ${scopeLabel}${strategyLabel}${provision.domesticOnly ? " (domestic only)" : ""}`,
    },
  };
}

/**
 * Resolves bill provisions by fetching legislation types and formatting.
 */
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

    // Live current law per legislation type, snapshot-independent. The shared
    // loader keys statePolicies on the national pseudo-stateId and falls back to
    // the latest un-repealed enactedLaws row, exactly as this file did before.
    // Legacy bills predate `countryId` and carry only the national pseudo-stateId
    // ("uk_national", ...). Defaulting straight to US would send a UK bill's
    // current-law lookup to the federal store and find nothing.
    const nationalScope = {
      scope: "national" as const,
      countryId: (bill.countryId ??
        (bill.stateId ? inferCountryIdFromStateId(bill.stateId) : undefined) ??
        "US") as CountryId,
    };
    const livePolicies = await loadLiveCurrentPolicies(db, nationalScope, legTypeIds);

    for (const provision of bill.provisions) {
      if (!isPolicyProvision(provision)) {
        if (provision.type === "tariff") {
          provisionsResolved.push({
            legislationTypeName: "Tariff",
            proposed: { name: formatTariffProvisionLabel(provision) },
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
            proposed: { name: policyOptionName },
            effectDirection: 0,
            directionLabel: "Center",
            ...(nationalizationDetail && { nationalizationDetail }),
          });
          continue;
        }

        if (provision.type === "privatize") {
          provisionsResolved.push({
            legislationTypeName: "Privatization",
            proposed: { name: `Spin out: ${provision.newCorpName}` },
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "designate_strategic_sector") {
          provisionsResolved.push({
            legislationTypeName: "Strategic-Sector Designation",
            proposed: { name: provision.sectorType },
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
            proposed: { name: `${embargoLabel.summary}: ${embargoLabel.description}` },
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
            proposed: { name: detail },
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "euro_adoption") {
          provisionsResolved.push({
            legislationTypeName: "Currency Adoption",
            proposed: { name: "Adopt shared currency" },
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "union_law") {
          provisionsResolved.push({
            legislationTypeName: "Union Law",
            proposed: {
              name:
                provision.banAction === "ban"
                  ? "Ban unions nationally"
                  : provision.banAction === "repeal_ban"
                    ? "Repeal the union ban"
                    : provision.bias > 0
                      ? `Collective-bargaining strength: +${provision.bias}`
                      : provision.bias < 0
                        ? `Right-to-work strength: ${provision.bias}`
                        : "Neutral",
            },
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "electoral_law") {
          provisionsResolved.push({
            legislationTypeName: "Electoral Law",
            proposed: { name: describeElectoralLaw(provision) },
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "central_bank_independence") {
          provisionsResolved.push({
            legislationTypeName: "Central Bank Independence",
            proposed: {
              name:
                provision.action === "grant"
                  ? "Grant the central bank operational independence"
                  : "Return rate-setting to the government",
            },
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
            proposed: { name: `${provision.targetCountry} · ${warGoalLabel(provision.warGoal)}` },
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "join_conflict") {
          provisionsResolved.push({
            legislationTypeName: "Entry into the Conflict",
            proposed: { name: `Join side ${provision.side} at ${provision.organizationId}'s call` },
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        if (provision.type === "create_department") {
          const dept = formatCreateDepartmentLabel(provision);
          provisionsResolved.push({
            legislationTypeName: dept.legislationTypeName,
            proposed: dept.proposed,
            effectDirection: 0,
            directionLabel: "Center",
          });
          continue;
        }

        const subsidyProvision = formatSubsidyProvisionLabel(provision);
        provisionsResolved.push({
          legislationTypeName: subsidyProvision.legislationTypeName,
          proposed: subsidyProvision.proposed,
          effectDirection: 0,
          directionLabel: "Center",
        });
        continue;
      }

      const canonicalLegislationTypeId = canonicalizeLegislationTypeId(provision.legislationTypeId);
      const lt = canonicalLegislationTypeId
        ? legislationTypeMap.get(canonicalLegislationTypeId)
        : null;
      const prov = provision as SnapshottedProvision & {
        legislationTypeId: string;
        proposedRate?: number;
      };
      const posLabel =
        prov.economic != null || prov.social != null
          ? formatBillPositionLabel(prov.economic, prov.social)
          : undefined;

      provisionsResolved.push(
        await resolvePolicyProvision(db, {
          scope: nationalScope,
          lt,
          provision: prov,
          live: canonicalLegislationTypeId
            ? livePolicies.get(canonicalLegislationTypeId)
            : undefined,
          legislationTypeName:
            lt?.name ??
            humanizeLegislationTypeId(provision.legislationTypeId) ??
            provision.legislationTypeId,
          directionLabel: directionLabel(prov.effectDirection),
          ...(posLabel ? { positionLabel: posLabel } : {}),
        })
      );
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
      proposed: { name: summary },
      current: { name: detail },
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
  // Both chambers vote at once, so eligibility is per-CHAMBER-MEMBERSHIP rather than
  // per-currentChamber: `isInCurrentChamber` below would gate the whole bill on the
  // display default and silently hide the vote button from one entire house.
  const inConcurrentVote = bill.status === "active_both";

  // isHouseMember = lower chamber member, isSenateMember = upper chamber member
  const currentChamberType = current === "joint" ? lowerChamberKey : current;
  const isInCurrentChamber =
    (currentChamberType === lowerChamberKey && isHouseMember) ||
    (upperChamberKey != null && currentChamberType === upperChamberKey && isSenateMember);

  const canVoteOrigin = inCabinetReview
    ? canCabinetVote && myCharacterId != null && !bill.votes?.[myCharacterId]
    : (inOriginVote && isInCurrentChamber) || (inConcurrentVote && isHouseMember);
  const canVoteOther = (inOtherVote && isInCurrentChamber) || (inConcurrentVote && isSenateMember);
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
      // Only US Senate bills in the Senate that are actively being voted on.
      // Concurrent (`active_both`) bills are excluded here and refused by name in
      // the filibuster command for the same reason — see nationalBillActions.
      !!myCharacterId &&
      isSenateMember &&
      bill.currentChamber === "senate" &&
      (bill.status === "active" || bill.status === "active_other") &&
      // Senator hasn't already filibustered this bill
      !(bill.filibusterInvocations ?? []).some((inv) => inv.characterId === myCharacterId),
    whipPanel,
  };
}
