import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import type { BillChamber, BillStatus } from "@/lib/db/types/legislation";
import type { StateBillDisplay } from "@/lib/legislature/dto/stateLegislature";
import { isVotingDeadlinePassed } from "./billVotingWindow";
// Imported from the leaf module, NOT the provisionEnrichment barrel. This file
// is reachable from client components, and the barrel re-exports the fiscal
// resolver, which pulls the Mongo driver into the client bundle and breaks the
// production build.
import { directionLabel as directionFromEffect } from "@/lib/legislature/provisionEnrichment/optionLabel";

/**
 * Map a subnational bill API shape to {@link BillDisplay} so state/region bills can use
 * the same {@link BillCard} broadsheet row as national congress bills.
 *
 * Passing `currentTurn` makes the voting-deadline check turn-aware so it stays consistent
 * with the server-side resolution. Without it, the check falls back to the legacy date
 * comparison.
 */
export function mapStateBillToBillDisplay(
  sb: StateBillDisplay,
  opts: {
    chamber: BillChamber;
    canVote: boolean;
    currentTurn?: number;
  }
): BillDisplay {
  const totalVotes = sb.votesFor + sb.votesAgainst + sb.votesAbstain;

  const mappedStatus: BillStatus = mapStateStatusToBillStatus(sb.status);

  const firstProv = sb.provisions?.[0];
  const provisions =
    sb.provisions?.map((p) => ({
      legislationTypeId: "",
      legislationTypeName: p.legislationTypeName ?? "",
      effectDirection: p.effectDirection,
      directionLabel: directionFromEffect(p.effectDirection),
      positionLabel: p.proposed.name,
      effectTargetLabel: p.effectTargetsWeighted?.[0]?.metricId
        ? `${p.legislationTypeName ?? "Policy"}: ${p.effectTargetsWeighted[0].metricId}`
        : undefined,
      economic: undefined,
      social: undefined,
    })) ?? undefined;

  const nowForCheck = new Date();
  const originVotingClosed =
    sb.status === "active" &&
    isVotingDeadlinePassed(sb.votingEndsAt, nowForCheck, sb.votingEndsOnTurn, opts.currentTurn);
  const overrideVotingClosed =
    sb.status === "veto_override" &&
    isVotingDeadlinePassed(
      sb.overrideVotingEndsAt,
      nowForCheck,
      sb.overrideVotingEndsOnTurn,
      opts.currentTurn
    );
  const canVoteOrigin =
    opts.canVote &&
    ((sb.status === "active" && !originVotingClosed) ||
      (sb.status === "veto_override" && !overrideVotingClosed));

  return {
    id: sb.id,
    title: sb.title,
    summary: sb.summary,
    ...(sb.adminProposed ? { adminProposed: true } : {}),
    originChamber: opts.chamber,
    currentChamber: opts.chamber,
    sponsorId: sb.sponsorId ?? null,
    ...(sb.sponsorSequentialId != null ? { sponsorSequentialId: sb.sponsorSequentialId } : {}),
    sponsorName: sb.sponsorName,
    sponsorParty: sb.sponsorParty ?? "",
    sponsorPartyName: sb.sponsorParty ?? "",
    sponsorPartyColor: sb.sponsorPartyColor ?? "#6b7280",
    status: mappedStatus,
    votesFor: sb.votesFor,
    votesAgainst: sb.votesAgainst,
    votesAbstain: sb.votesAbstain,
    totalVotes,
    otherChamberVotesFor: 0,
    otherChamberVotesAgainst: 0,
    otherChamberVotesAbstain: 0,
    category: "",
    legislationTypeId: null,
    legislationTypeName: sb.legislationTypeName ?? firstProv?.legislationTypeName ?? null,
    effectDirection: firstProv?.effectDirection ?? null,
    directionLabel: firstProv ? directionFromEffect(firstProv.effectDirection) : null,
    positionLabel: firstProv?.proposed.name ?? null,
    effectTargetLabel: null,
    provisions,
    proposedAt: sb.proposedAt,
    votingStartedAt: sb.proposedAt,
    votingEndsAt:
      sb.status === "veto_override" && sb.overrideVotingEndsAt
        ? sb.overrideVotingEndsAt
        : (sb.votingEndsAt ?? null),
    votingEndsOnTurn:
      sb.status === "veto_override"
        ? (sb.overrideVotingEndsOnTurn ?? null)
        : (sb.votingEndsOnTurn ?? null),
    otherChamberVotingEndsAt: null,
    otherChamberVotingEndsOnTurn: null,
    passedAt: null,
    enactedAt: sb.status === "enacted" || sb.status === "signed" ? sb.proposedAt : null,
    myVote: sb.myVote ?? null,
    myOtherChamberVote: null,
    canVoteOrigin,
    canVoteOther: false,
    requiresExecutiveAction: false,
    failedAt: sb.status === "failed" || sb.status === "override_failed" ? sb.proposedAt : null,
  };
}

/** Exported for state bill detail page timeline / badges */
export function mapStateStatusToBillStatus(s: string): BillStatus {
  switch (s) {
    case "proposed":
      return "proposed";
    case "active":
      return "active";
    case "passed":
      return "passed_origin";
    case "signed":
    case "enacted":
      return "signed";
    case "vetoed":
      return "vetoed";
    case "veto_override":
      return "veto_override";
    case "override_failed":
      return "override_failed";
    case "failed":
      return "failed";
    default:
      return "proposed";
  }
}
