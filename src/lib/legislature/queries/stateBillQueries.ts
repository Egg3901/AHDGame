import { ObjectId, type Db } from "mongodb";
import type { AuthUser } from "@/lib/auth";
import {
  getCountryConfig,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { subNationalChamberSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { buildVotesByParty, type ScopedVoteOfficial } from "@/lib/congress/billVoting";
import { resolveBillCardTally, scopeStateBillVotes } from "@/lib/legislature/stateBillVoteScope";
import { snapshotWeightMap } from "@/lib/legislature/voteSnapshot";
import type {
  Character,
  ElectedOfficial,
  LegislationType,
  NPP,
  PoliticalParty,
  StateBill,
  State,
  StatePolicy,
} from "@/lib/db/types";
import type { EnactedLaw } from "@/lib/db/types/budget";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { StateBillDetail } from "@/lib/legislature/dto/stateBillDetail";
import type { StateBillDisplay } from "@/lib/legislature/dto/stateLegislature";
import { STATE_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { computeProvisionEffectChips } from "@/lib/legislature/provisionEffects";
import { optionIntensity } from "@/lib/legislature/optionIntensity";
import { axisRelevant, formatSubsidyProvisionLabel } from "@/lib/congress/billEnrichment";

export interface StateLegislatureBillsPage {
  blockedProvisions: { legislationTypeId: string; policyOptionId: string }[];
  bills: StateBillDisplay[];
  budget: {
    totalBudget: number;
    enactedBillCosts: number;
    surplus: number;
    isOverBudget: boolean;
    turnsOverBudget: number;
  } | null;
}

export async function listStateLegislatureBills(
  db: Db,
  {
    countryId,
    stateId,
    authUser,
  }: {
    countryId: CountryId;
    stateId: string;
    authUser: AuthUser | null;
  }
): Promise<StateLegislatureBillsPage> {
  const [bills, parties] = await Promise.all([
    db
      .collection<StateBill>("stateBills")
      .find({ stateId })
      .sort({ proposedAt: -1 })
      .limit(100)
      .toArray(),
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
  ]);
  const partyMap = new Map(parties.map((party) => [String(party.sequentialId), party]));

  // Load the chamber's CURRENT seat holders once so every bill card can scope
  // its displayed tally to who actually sits now — same treatment the bill
  // detail page uses (scopeStateBillVotes). Without this, votes cast before a
  // sub-national election are added to votes cast after it and the card totals
  // exceed the chamber size (bug #0836 / ticket #973: 48 votes shown in a
  // 31-seat chamber). Detail/resolution already scope; only the list card did not.
  const subNationalOffice = getSubNationalLegislatureKey(countryId);
  const chamberOfficials = subNationalOffice
    ? await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({
          state: stateId,
          officeType: subNationalOffice,
          countryId: countryId as ElectedOfficial["countryId"],
        })
        .project<ScopedVoteOfficial>({
          characterId: 1,
          countryId: 1,
          nppId: 1,
          officeType: 1,
          seatsHeld: 1,
        })
        .toArray()
    : [];

  const legislationTypeIds = [
    ...new Set(bills.map((bill) => bill.legislationTypeId).filter(Boolean)),
  ] as string[];
  const legislationTypes =
    legislationTypeIds.length > 0
      ? await db
          .collection<LegislationType>("legislationTypes")
          .find({ _id: { $in: legislationTypeIds } })
          .toArray()
      : [];
  const legislationTypeMap = new Map(legislationTypes.map((type) => [type._id, type]));

  let myCharacterId: string | null = null;
  if (authUser) {
    const character = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(authUser.userId) }, { projection: { _id: 1 } });
    myCharacterId = character?._id.toString() ?? null;
  }

  const countryConfig = getCountryConfig(countryId);
  let budget: StateLegislatureBillsPage["budget"] = null;
  if (countryConfig.subNationalChamber?.regionalModel) {
    const budgetDoc = await db
      .collection<RegionalBudget>("regionalBudgets")
      .findOne({ _id: stateId });
    if (budgetDoc) {
      budget = {
        totalBudget: budgetDoc.totalBudget,
        enactedBillCosts: budgetDoc.enactedBillCosts,
        surplus: budgetDoc.surplus,
        isOverBudget: budgetDoc.isOverBudget,
        turnsOverBudget: budgetDoc.turnsOverBudget,
      };
    }
  }

  const sponsorObjectIds = [
    ...new Set(bills.map((bill) => bill.sponsorId).filter((id): id is ObjectId => id != null)),
  ];
  const sponsorChars =
    sponsorObjectIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: sponsorObjectIds } }, { projection: { _id: 1, sequentialId: 1 } })
          .toArray()
      : [];
  const sponsorSeqMap = new Map(
    sponsorChars.map((c) => [c._id.toString(), c.sequentialId] as const)
  );

  const activeStateBills = bills.filter(
    (bill) => !(STATE_TERMINAL_STATUSES as string[]).includes(bill.status)
  );
  const blockedProvisions: { legislationTypeId: string; policyOptionId: string }[] = [];
  for (const bill of activeStateBills) {
    if (!bill.provisions) continue;
    for (const provision of bill.provisions) {
      if (provision.type === "subsidy" || provision.type === "end_subsidy") continue;
      const policyProvision = provision as { legislationTypeId?: string; policyOptionId?: string };
      if (policyProvision.legislationTypeId && policyProvision.policyOptionId) {
        blockedProvisions.push({
          legislationTypeId: policyProvision.legislationTypeId,
          policyOptionId: policyProvision.policyOptionId,
        });
      }
    }
  }

  // Scope each bill card's headline tally to the current chamber. Falls back to
  // the stored aggregate only when there are no current-holder votes to scope
  // (e.g. no sub-national chamber, or every voter has since left the seat) —
  // matching the bill detail page's `hasScopedVotes` guard.
  const scopedTallyByBill = new Map<string, { for: number; against: number; abstain: number }>();
  for (const bill of bills) {
    scopedTallyByBill.set(
      bill._id.toString(),
      resolveBillCardTally(
        bill.votes,
        { for: bill.votesFor, against: bill.votesAgainst, abstain: bill.votesAbstain },
        bill.voteSnapshot,
        chamberOfficials,
        subNationalOffice ? { countryId, officeType: subNationalOffice } : null
      )
    );
  }

  return {
    blockedProvisions,
    bills: bills.map((bill) => ({
      id: bill._id.toString(),
      title: bill.title,
      summary: bill.summary,
      ...(bill.adminProposed ? { adminProposed: true } : {}),
      sponsorId: bill.sponsorId?.toString() ?? null,
      ...(bill.sponsorId && sponsorSeqMap.has(bill.sponsorId.toString())
        ? { sponsorSequentialId: sponsorSeqMap.get(bill.sponsorId.toString()) }
        : {}),
      sponsorName: bill.sponsorName,
      sponsorParty: partyMap.get(bill.sponsorParty ?? "")?.abbreviation ?? bill.sponsorParty,
      sponsorPartyColor: partyMap.get(bill.sponsorParty ?? "")?.color,
      status: bill.status,
      votesFor: scopedTallyByBill.get(bill._id.toString())!.for,
      votesAgainst: scopedTallyByBill.get(bill._id.toString())!.against,
      votesAbstain: scopedTallyByBill.get(bill._id.toString())!.abstain,
      legislationTypeName: bill.legislationTypeId
        ? legislationTypeMap.get(bill.legislationTypeId)?.name
        : null,
      proposedAt: bill.proposedAt.toISOString(),
      votingEndsAt: bill.votingEndsAt?.toISOString(),
      votingEndsOnTurn: bill.votingEndsOnTurn,
      governorActionDeadline: bill.governorActionDeadline?.toISOString(),
      governorActionDeadlineOnTurn: bill.governorActionDeadlineOnTurn,
      overrideVotingEndsAt: bill.overrideVotingEndsAt?.toISOString(),
      overrideVotingEndsOnTurn: bill.overrideVotingEndsOnTurn,
      myVote: myCharacterId ? (bill.votes[myCharacterId] ?? null) : null,
      ...(bill.vetoMessage ? { hasVetoMessage: true } : {}),
      provisions: (bill.provisions ?? []).map((provision) => {
        if (provision.type === "subsidy" || provision.type === "end_subsidy") {
          return {
            legislationTypeName: null,
            policyOptionName: null,
            effectDirection: 0,
            effectTargetsWeighted: [],
            annualCostPerCapita: null,
            gdpPerCapitaMultiplier: null,
            type: provision.type,
            scopeType: provision.scopeType,
            targetSectorType: provision.targetSectorType ?? null,
          };
        }
        const legislationType = legislationTypeMap.get(provision.legislationTypeId);
        const matchedOption = legislationType?.policyOptions?.find(
          (option) => option.effectDirection === provision.effectDirection
        );
        return {
          legislationTypeName: legislationType?.name ?? null,
          policyOptionName: matchedOption?.name ?? null,
          effectDirection: provision.effectDirection,
          effectTargetsWeighted: legislationType?.effectTargetsWeighted ?? [],
          groupApprovals: matchedOption?.groupApprovals ?? {},
          annualCostPerCapita: matchedOption?.annualCostPerCapita ?? null,
          gdpPerCapitaMultiplier: matchedOption?.gdpPerCapitaMultiplier ?? null,
        };
      }),
    })),
    budget,
  };
}

export async function getStateLegislatureBillDetail(
  db: Db,
  {
    countryId,
    stateId,
    billId,
    authUser,
  }: {
    countryId: CountryId;
    stateId: string;
    billId: string;
    authUser: AuthUser | null;
  }
): Promise<StateBillDetail | null> {
  const bill = await db.collection<StateBill>("stateBills").findOne({
    _id: new ObjectId(billId),
    stateId,
  });
  if (!bill) return null;

  // Chamber size for the vote-seating hero — same source the composition uses
  // (CN's elected People's Congress is sized separately from `stateSenateSeats`).
  const stateDoc = await db
    .collection<State>("states")
    .findOne({ _id: stateId, countryId }, { projection: { stateSenateSeats: 1 } });
  const eligibleSeats = stateDoc
    ? subNationalChamberSeats(
        countryId,
        { _id: stateId, stateSenateSeats: stateDoc.stateSenateSeats },
        await getGameStatePreset(db)
      )
    : 0;

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .toArray();
  const partyMap = new Map(parties.map((party) => [String(party.sequentialId), party]));

  const legislationTypeIds = bill.legislationTypeId ? [bill.legislationTypeId] : [];
  const provisionTypeIds = [
    ...new Set(
      (bill.provisions ?? [])
        .map((provision) => ("legislationTypeId" in provision ? provision.legislationTypeId : null))
        .filter(Boolean) as string[]
    ),
  ];
  const allLegislationTypeIds = [...new Set([...legislationTypeIds, ...provisionTypeIds])];
  const legislationTypes =
    allLegislationTypeIds.length > 0
      ? await db
          .collection<LegislationType>("legislationTypes")
          .find({ _id: { $in: allLegislationTypeIds } })
          .toArray()
      : [];
  const legislationTypeMap = new Map(legislationTypes.map((type) => [type._id, type]));

  let myCharacterId: string | null = null;
  if (authUser) {
    const character = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(authUser.userId) }, { projection: { _id: 1 } });
    myCharacterId = character?._id.toString() ?? null;
  }

  const subNationalOffice = getSubNationalLegislatureKey(countryId);

  let canVote = false;
  if (myCharacterId) {
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: subNationalOffice,
      state: stateId,
      characterId: new ObjectId(myCharacterId),
      countryId,
    });
    canVote = !!official;
  }

  let canGovernorAction = false;
  if (myCharacterId && bill.status === "passed") {
    // Country-aware + delegation-aware: the regional chief executive (resolved
    // per country, not hardcoded "governor") OR an authorized party officer of
    // an NPP-held office may sign/veto. Mirrors takeStateBillGovernorAction.
    const { canManageOffice } = await import("@/lib/governorOffice/access");
    canGovernorAction = await canManageOffice(db, countryId, stateId, new ObjectId(myCharacterId));
  }

  const voteKeys = Object.keys(bill.votes ?? {});
  const characterIds = voteKeys.filter((key) => ObjectId.isValid(key));
  // NPP votes are keyed `npp_<objectId>`; extract the inner id.
  const nppKeyToId = new Map<string, string>();
  for (const key of voteKeys) {
    if (key.startsWith("npp_")) {
      const id = key.slice(4);
      if (ObjectId.isValid(id)) nppKeyToId.set(key, id);
    }
  }
  const nppObjectIds = [...nppKeyToId.values()].map((id) => new ObjectId(id));

  const characters =
    characterIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds.map((id) => new ObjectId(id)) } })
          .project({ _id: 1, party: 1 })
          .toArray()
      : [];
  const npps =
    nppObjectIds.length > 0
      ? await db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppObjectIds } })
          .project<{ _id: ObjectId; party?: string }>({ _id: 1, party: 1 })
          .toArray()
      : [];
  const voterPartyMap = new Map<string, string>();
  for (const character of characters) {
    voterPartyMap.set(character._id.toString(), character.party ?? "independent");
  }
  for (const [nppKey, nppIdStr] of nppKeyToId) {
    const npp = npps.find((n) => n._id.toString() === nppIdStr);
    voterPartyMap.set(nppKey, npp?.party ?? "independent");
  }

  // Scope the displayed tally to the chamber's CURRENT seat holders and weight
  // each vote by their current seatsHeld — same treatment the national bill page
  // uses (buildScopedVoteInputs). Without this, votes cast before a sub-national
  // election are added to votes cast after it, so the totals can exceed the
  // chamber size (bug #0836: 35 votes shown in a 31-seat chamber).
  // A concluded phase has a frozen snapshot — derive both the headline and the
  // per-party breakdown from it so a post-election chamber turnover cannot
  // recompute (and collapse) the historical tally (#0982). Only an in-progress
  // vote (no snapshot yet) live-scopes to the current chamber (#0836).
  const originSnapshot = bill.voteSnapshot;
  const scopedVotes = originSnapshot
    ? null
    : await scopeStateBillVotes(db, bill.votes, {
        stateId: bill.stateId,
        countryId,
        officeType: subNationalOffice,
      });
  const voteByParty = originSnapshot
    ? buildVotesByParty(
        originSnapshot.votes,
        voterPartyMap,
        partyMap,
        snapshotWeightMap(originSnapshot)
      )
    : buildVotesByParty(scopedVotes!.votes, voterPartyMap, partyMap, scopedVotes!.weightMap);

  let voteByPartyOverride: ReturnType<typeof buildVotesByParty> = [];
  let scopedOverrideVotes: Awaited<ReturnType<typeof scopeStateBillVotes>> | null = null;
  if (bill.overrideVotes && Object.keys(bill.overrideVotes).length > 0) {
    const overrideKeys = Object.keys(bill.overrideVotes);
    const overrideCharacterIds = overrideKeys.filter((key) => ObjectId.isValid(key));
    const overrideCharacters =
      overrideCharacterIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: overrideCharacterIds.map((id) => new ObjectId(id)) } })
            .project({ _id: 1, party: 1 })
            .toArray()
        : [];
    const overrideVoterPartyMap = new Map(
      overrideCharacters.map((character) => [
        character._id.toString(),
        character.party ?? "independent",
      ])
    );
    if (bill.overrideVoteSnapshot) {
      // Frozen override result — same treatment as the origin vote (#0982).
      voteByPartyOverride = buildVotesByParty(
        bill.overrideVoteSnapshot.votes,
        overrideVoterPartyMap,
        partyMap,
        snapshotWeightMap(bill.overrideVoteSnapshot)
      );
    } else {
      const normalizedOverrideVotes: Record<string, "for" | "against" | "abstain"> = {};
      for (const [key, vote] of Object.entries(bill.overrideVotes)) {
        normalizedOverrideVotes[key] = vote === "for" ? "for" : "against";
      }
      scopedOverrideVotes = await scopeStateBillVotes(db, normalizedOverrideVotes, {
        stateId: bill.stateId,
        countryId,
        officeType: subNationalOffice,
      });
      voteByPartyOverride = buildVotesByParty(
        scopedOverrideVotes.votes,
        overrideVoterPartyMap,
        partyMap,
        scopedOverrideVotes.weightMap
      );
    }
  }

  // Resolve the region's CURRENT law per legislation type so each provision can
  // show a Current → Proposed comparison (parity with the national bill page).
  // Primary source is `statePolicies` (keyed by this region's stateId); fall back
  // to the most recent un-repealed enacted law for types missing from it.
  const provisionLegTypeIds = [
    ...new Set(
      (bill.provisions ?? [])
        .map((p) => ("legislationTypeId" in p ? p.legislationTypeId : null))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const currentPolicyByType = new Map<
    string,
    { policyOptionIndex?: number; policyOptionId?: string }
  >();
  if (provisionLegTypeIds.length > 0) {
    const currentStatePolicies = await db
      .collection<StatePolicy>("statePolicies")
      .find({ stateId: bill.stateId, legislationTypeId: { $in: provisionLegTypeIds } })
      .toArray();
    for (const sp of currentStatePolicies) currentPolicyByType.set(sp.legislationTypeId, sp);

    const missingIds = provisionLegTypeIds.filter((id) => !currentPolicyByType.has(id));
    if (missingIds.length > 0) {
      const laws = await db
        .collection<EnactedLaw>("enactedLaws")
        .find({
          stateId: bill.stateId,
          legislationTypeId: { $in: missingIds },
          repealedAt: { $exists: false },
        })
        .sort({ enactedAt: -1 })
        .toArray();
      const seen = new Set<string>();
      for (const law of laws) {
        if (seen.has(law.legislationTypeId)) continue;
        seen.add(law.legislationTypeId);
        if (law.policyOptionIndex !== undefined) {
          currentPolicyByType.set(law.legislationTypeId, {
            policyOptionIndex: law.policyOptionIndex,
          });
        }
      }
    }
  }

  const provisions = (bill.provisions ?? []).map((provision) => {
    if (provision.type === "subsidy" || provision.type === "end_subsidy") {
      // Subsidies have no policy option / current law → proposed-only box. Build a
      // label (mirroring the national page) so the shared card has something to show.
      const { legislationTypeName, policyOptionName } = formatSubsidyProvisionLabel(provision);
      return {
        legislationTypeName,
        policyOptionName,
        effectDirection: 0,
        effectTargetsWeighted: [],
        annualCostPerCapita: null,
        gdpPerCapitaMultiplier: null,
        type: provision.type,
        scopeType: provision.scopeType,
        targetSectorType: provision.targetSectorType ?? null,
      };
    }
    const legislationType = legislationTypeMap.get(provision.legislationTypeId);
    const options = legislationType?.policyOptions ?? [];
    const proposedIdx = provision.policyOptionId
      ? options.findIndex((o) => o.id === provision.policyOptionId)
      : options.findIndex((o) => o.effectDirection === provision.effectDirection);
    const proposedOption = proposedIdx >= 0 ? options[proposedIdx] : undefined;

    const cur = currentPolicyByType.get(provision.legislationTypeId);
    let currentIdx: number | undefined;
    if (cur?.policyOptionIndex !== undefined) {
      currentIdx = cur.policyOptionIndex;
    } else if (cur?.policyOptionId) {
      const i = options.findIndex((o) => o.id === cur.policyOptionId);
      if (i >= 0) currentIdx = i;
    }
    const currentOption = currentIdx !== undefined ? options[currentIdx] : undefined;

    const effects = computeProvisionEffectChips({
      effectTargetsWeighted: legislationType?.effectTargetsWeighted ?? [],
      proposedIntensity:
        proposedIdx >= 0
          ? optionIntensity(options, proposedIdx)
          : Math.sign(provision.effectDirection),
      currentIntensity: currentIdx !== undefined ? optionIntensity(options, currentIdx) : 0,
    });

    return {
      legislationTypeName: legislationType?.name ?? null,
      policyOptionName: proposedOption?.name ?? null,
      policyOptionDescription: proposedOption?.explanation ?? null,
      currentPolicyOptionName: currentOption?.name ?? null,
      currentPolicyOptionDescription: currentOption?.explanation ?? null,
      effectDirection: provision.effectDirection,
      effectTargetsWeighted: legislationType?.effectTargetsWeighted ?? [],
      groupApprovals: proposedOption?.groupApprovals ?? {},
      archetypeApprovals: proposedOption?.archetypeApprovals ?? proposedOption?.groupApprovals,
      annualCostPerCapita: proposedOption?.annualCostPerCapita ?? null,
      gdpPerCapitaMultiplier: proposedOption?.gdpPerCapitaMultiplier ?? null,
      economic:
        proposedOption?.economic != null && axisRelevant(legislationType, "economic")
          ? proposedOption.economic
          : null,
      social:
        proposedOption?.social != null && axisRelevant(legislationType, "social")
          ? proposedOption.social
          : null,
      policyDomain: legislationType?.policyDomain ?? null,
      currentPolicyIndex: currentIdx,
      proposedPolicyIndex: proposedIdx >= 0 ? proposedIdx : undefined,
      ...(options.length > 0 && {
        policyOptionScores: options.map((o) => (o.economic ?? 0) + (o.social ?? 0)),
      }),
      effects,
    };
  });

  // Headline tallies come from the scoped (current-chamber) votes so they match
  // the per-party breakdown and never cross an election boundary. Fall back to
  // the stored aggregate only when there are no current-holder votes to scope.
  const hasScopedVotes = !originSnapshot && Object.keys(scopedVotes?.votes ?? {}).length > 0;
  const headlineVotesFor = originSnapshot
    ? originSnapshot.totals.for
    : hasScopedVotes
      ? scopedVotes!.totals.for
      : bill.votesFor;
  const headlineVotesAgainst = originSnapshot
    ? originSnapshot.totals.against
    : hasScopedVotes
      ? scopedVotes!.totals.against
      : bill.votesAgainst;
  const headlineVotesAbstain = originSnapshot
    ? originSnapshot.totals.abstain
    : hasScopedVotes
      ? scopedVotes!.totals.abstain
      : bill.votesAbstain;
  const overrideSnapshot = bill.overrideVoteSnapshot;
  const hasScopedOverrideVotes =
    scopedOverrideVotes != null && Object.keys(scopedOverrideVotes.votes ?? {}).length > 0;
  const headlineOverrideVotesFor = overrideSnapshot
    ? overrideSnapshot.totals.for
    : hasScopedOverrideVotes
      ? scopedOverrideVotes!.totals.for
      : (bill.overrideVotesFor ?? 0);
  const headlineOverrideVotesAgainst = overrideSnapshot
    ? overrideSnapshot.totals.against
    : hasScopedOverrideVotes
      ? scopedOverrideVotes!.totals.against
      : (bill.overrideVotesAgainst ?? 0);

  let sponsorSequentialId: number | undefined;
  if (bill.sponsorId) {
    const sponsorChar = await db
      .collection<Character>("characters")
      .findOne({ _id: bill.sponsorId }, { projection: { sequentialId: 1 } });
    sponsorSequentialId = sponsorChar?.sequentialId;
  }

  return {
    id: bill._id.toString(),
    stateId: bill.stateId,
    countryId,
    title: bill.title,
    summary: bill.summary,
    ...(bill.adminProposed ? { adminProposed: true } : {}),
    sponsorId: bill.sponsorId?.toString() ?? null,
    ...(sponsorSequentialId != null ? { sponsorSequentialId } : {}),
    sponsorName: bill.sponsorName,
    sponsorParty: partyMap.get(bill.sponsorParty ?? "")?.abbreviation ?? bill.sponsorParty,
    sponsorPartyColor: partyMap.get(bill.sponsorParty ?? "")?.color,
    status: bill.status,
    votesFor: headlineVotesFor,
    votesAgainst: headlineVotesAgainst,
    votesAbstain: headlineVotesAbstain,
    eligibleSeats,
    legislationTypeName: bill.legislationTypeId
      ? (legislationTypeMap.get(bill.legislationTypeId)?.name ?? null)
      : null,
    proposedAt: bill.proposedAt.toISOString(),
    votingEndsAt: bill.votingEndsAt?.toISOString(),
    votingEndsOnTurn: bill.votingEndsOnTurn,
    governorActionDeadline: bill.governorActionDeadline?.toISOString(),
    governorActionDeadlineOnTurn: bill.governorActionDeadlineOnTurn,
    overrideVotingEndsAt: bill.overrideVotingEndsAt?.toISOString(),
    overrideVotingEndsOnTurn: bill.overrideVotingEndsOnTurn,
    myVote: myCharacterId ? (bill.votes[myCharacterId] ?? null) : null,
    myOverrideVote:
      myCharacterId && bill.overrideVotes ? (bill.overrideVotes[myCharacterId] ?? null) : null,
    provisions,
    voteByParty,
    voteByPartyOverride,
    overrideVotesFor: headlineOverrideVotesFor,
    overrideVotesAgainst: headlineOverrideVotesAgainst,
    canVote,
    canGovernorAction,
    ...(bill.vetoMessage ? { vetoMessage: bill.vetoMessage } : {}),
  };
}
