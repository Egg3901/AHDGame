/**
 * Display-row mapping for GET /api/congress/bills — turns Bill documents into
 * the BillDisplay DTO rows the bills list renders. Extracted from route.ts
 * verbatim (pure code motion; no behavior change).
 */
import type {
  AxisPositions,
  Bill,
  BillProvision,
  LegislationType,
  PoliticalParty,
} from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { buildVoteShiftPreview } from "@/lib/legislature/voteShiftPreview";
import { getPartyHex, formatBillPositionLabel } from "@/lib/utils/politics";
import {
  directionLabel,
  effectTargetLabelFromMetricId,
  axisRelevant,
} from "@/lib/congress/billEnrichment";
import {
  canonicalizeLegislationTypeId,
  getLegislationTypeById,
  humanizeLegislationTypeId,
} from "@/lib/legislationTypeAliases";
import {
  billRequiresExecutiveAction,
  getInternationalActionLabel,
  getInternationalActionSummary,
} from "@/lib/internationalOrganizations/withdrawalBills";
import { NATIONALIZATION_BILL_CATEGORIES, type BillCategory } from "@shared/constants/legislation";

/** Display row for a nationalization provision on a state-ownership bill. */
function natProvisionDisplay(
  p: BillProvision
): NonNullable<BillDisplay["provisions"]>[number] | null {
  if (p.type === "nationalize")
    return {
      legislationTypeId: "nationalize",
      legislationTypeName: "Nationalization",
      effectDirection: 0,
      directionLabel: "Center",
      effectTargetLabel: "Bring an asset into state ownership",
    };
  if (p.type === "privatize")
    return {
      legislationTypeId: "privatize",
      legislationTypeName: "Privatization",
      effectDirection: 0,
      directionLabel: "Center",
      effectTargetLabel: "Carve out and sell a state holding",
    };
  if (p.type === "designate_strategic_sector")
    return {
      legislationTypeId: "designate_strategic_sector",
      legislationTypeName: "Strategic-Sector Designation",
      effectDirection: 0,
      directionLabel: "Center",
      effectTargetLabel: `Designate ${p.sectorType} strategic`,
    };
  return null;
}

/** Build the BillDisplay rows for a page of bills (viewer-aware vote fields). */
export function buildBillDisplays(
  bills: Bill[],
  ctx: {
    partyMap: Map<string, PoliticalParty>;
    legislationTypeMap: Map<string, LegislationType>;
    myVoteMap: Map<string, { origin: string | null; other: string | null }>;
    myCharacterId: string | null;
    myChamber: "house" | "senate" | null;
    /** The viewer's own positions, for the Aye/Nay shift preview. */
    myPolicies?: AxisPositions | null;
  }
): BillDisplay[] {
  const { partyMap, legislationTypeMap, myVoteMap, myCharacterId, myChamber, myPolicies } = ctx;
  return bills.map((b) => {
    const canVoteOrigin =
      !!myCharacterId &&
      (b.status === "active_both"
        ? myChamber === "house"
        : b.status === "active" &&
          ((myChamber === "house" &&
            (b.currentChamber === "house" || b.currentChamber === "joint")) ||
            (myChamber === "senate" && b.currentChamber === "senate")));
    // On a concurrent bill both chambers are open, so a senator may vote regardless of
    // `currentChamber` — which is a display default on those bills, not the authority.
    const canVoteOther =
      !!myCharacterId &&
      (b.status === "active_both"
        ? myChamber === "senate"
        : b.status === "active_other" && myChamber === b.currentChamber);
    const partySlug = b.sponsorParty ?? "";
    const party = partyMap.get(partySlug);
    const origin = b.originChamber;
    const current = b.currentChamber;
    const internationalActionLabel = b.internationalAction
      ? getInternationalActionLabel(b.internationalAction)
      : null;
    const internationalActionSummary = b.internationalAction
      ? getInternationalActionSummary(b.internationalAction)
      : null;
    const displayProvisions = NATIONALIZATION_BILL_CATEGORIES.has(
      (b.category ?? "") as BillCategory
    )
      ? ((b.provisions ?? []).map(natProvisionDisplay).filter(Boolean) as NonNullable<
          BillDisplay["provisions"]
        >)
      : (b.provisions?.filter(isPolicyProvision).map((p) => {
          const lt = getLegislationTypeById(legislationTypeMap, p.legislationTypeId);
          const posLabel =
            p.economic != null || p.social != null
              ? formatBillPositionLabel(p.economic, p.social)
              : undefined;
          const policyOption =
            p.policyOptionId && lt?.policyOptions
              ? lt.policyOptions.find((o) => o.id === p.policyOptionId)
              : undefined;
          const optionLabel = policyOption?.explanation ?? policyOption?.name;
          return {
            legislationTypeId:
              canonicalizeLegislationTypeId(p.legislationTypeId) ?? p.legislationTypeId,
            legislationTypeName:
              lt?.name ?? humanizeLegislationTypeId(p.legislationTypeId) ?? p.legislationTypeId,
            effectDirection: p.effectDirection,
            directionLabel: directionLabel(p.effectDirection),
            ...(posLabel && { positionLabel: posLabel }),
            effectTargetLabel:
              optionLabel ??
              (lt?.effectTarget?.metricId
                ? effectTargetLabelFromMetricId(lt.effectTarget.metricId)
                : undefined),
            ...(p.economic != null && axisRelevant(lt, "economic") && { economic: p.economic }),
            ...(p.social != null && axisRelevant(lt, "social") && { social: p.social }),
          };
        }) ??
        (b.internationalAction
          ? [
              {
                legislationTypeId: b.internationalAction.type,
                legislationTypeName: internationalActionLabel ?? b.internationalAction.type,
                effectDirection: 0,
                directionLabel: "Center" as const,
                effectTargetLabel: internationalActionSummary ?? undefined,
              },
            ]
          : undefined));
    return {
      id: b._id.toString(),
      title: b.title,
      summary: b.summary,
      ...(b.adminProposed ? { adminProposed: true } : {}),
      originChamber: origin,
      currentChamber: current,
      sponsorId: b.sponsorId?.toString() ?? null,
      sponsorName: b.sponsorName,
      sponsorParty: partySlug,
      sponsorPartyName: party?.name ?? (partySlug || "Independent"),
      sponsorPartyColor: getPartyHex(partySlug, party?.color),
      status: b.status,
      votesFor: b.votesFor,
      votesAgainst: b.votesAgainst,
      votesAbstain: b.votesAbstain,
      totalVotes: b.votesFor + b.votesAgainst + b.votesAbstain,
      otherChamberVotesFor: b.otherChamberVotesFor ?? 0,
      otherChamberVotesAgainst: b.otherChamberVotesAgainst ?? 0,
      otherChamberVotesAbstain: b.otherChamberVotesAbstain ?? 0,
      category: b.category ?? "general",
      legislationTypeId: (() => {
        const firstPolicy = b.provisions?.find(isPolicyProvision);
        return canonicalizeLegislationTypeId(
          b.legislationTypeId ??
            firstPolicy?.legislationTypeId ??
            b.internationalAction?.type ??
            null
        );
      })(),
      legislationTypeName:
        (() => {
          const firstPolicy = b.provisions?.find(isPolicyProvision);
          const lid = b.legislationTypeId ?? firstPolicy?.legislationTypeId;
          if (!lid) return null;
          return (
            getLegislationTypeById(legislationTypeMap, lid)?.name ??
            humanizeLegislationTypeId(lid) ??
            null
          );
        })() ?? internationalActionLabel,
      effectDirection: (() => {
        const firstPolicy = b.provisions?.find(isPolicyProvision);
        return b.effectDirection ?? firstPolicy?.effectDirection ?? null;
      })(),
      directionLabel: (() => {
        const firstPolicy = b.provisions?.find(isPolicyProvision);
        const d = b.effectDirection ?? firstPolicy?.effectDirection ?? null;
        return d != null ? directionLabel(d) : null;
      })(),
      positionLabel: (() => {
        const firstPolicy = b.provisions?.find(isPolicyProvision);
        if (firstPolicy && (firstPolicy.economic != null || firstPolicy.social != null))
          return formatBillPositionLabel(firstPolicy.economic, firstPolicy.social);
        return null;
      })(),
      effectTargetLabel:
        (() => {
          const firstPolicy = b.provisions?.find(isPolicyProvision);
          const ltId = b.legislationTypeId ?? firstPolicy?.legislationTypeId;
          const lt = ltId ? getLegislationTypeById(legislationTypeMap, ltId) : undefined;
          if (firstPolicy?.policyOptionId && lt?.policyOptions) {
            const opt = lt.policyOptions.find((o) => o.id === firstPolicy.policyOptionId);
            if (opt) return opt.explanation ?? opt.name;
          }
          return lt?.effectTarget?.metricId
            ? effectTargetLabelFromMetricId(lt.effectTarget.metricId)
            : null;
        })() ?? internationalActionSummary,
      provisions: displayProvisions,
      proposedAt: b.proposedAt.toISOString(),
      votingStartedAt: b.votingStartedAt?.toISOString() ?? null,
      votingEndsAt: b.votingEndsAt?.toISOString() ?? null,
      votingEndsOnTurn: b.votingEndsOnTurn ?? null,
      otherChamberVotingEndsAt: b.otherChamberVotingEndsAt?.toISOString() ?? null,
      otherChamberVotingEndsOnTurn: b.otherChamberVotingEndsOnTurn ?? null,
      passedAt: b.passedOriginAt?.toISOString() ?? null,
      enactedAt: b.enactedAt?.toISOString() ?? null,
      myVote: (myVoteMap.get(b._id.toString())?.origin ?? null) as
        "for" | "against" | "abstain" | null,
      myOtherChamberVote: (myVoteMap.get(b._id.toString())?.other ?? null) as
        "for" | "against" | "abstain" | null,
      canVoteOrigin,
      canVoteOther,
      voteShiftPreview: buildVoteShiftPreview({
        provisions: (b.provisions ?? []).filter(isPolicyProvision),
        ledger: b.policyShiftLedger,
        characterId: myCharacterId,
        policies: myPolicies ?? undefined,
        previousVote: myCharacterId
          ? canVoteOther
            ? b.otherChamberVotes?.[myCharacterId]
            : b.votes?.[myCharacterId]
          : undefined,
        canVote: canVoteOrigin || canVoteOther,
      }),
      requiresExecutiveAction: billRequiresExecutiveAction(b),
      failedAt: b.failedAt?.toISOString() ?? null,
    };
  });
}
