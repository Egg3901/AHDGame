import { Suspense } from "react";
import { mergeRegionMetrics } from "@/lib/macroMetrics/merge";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import { notFound } from "next/navigation";
import { type Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import {
  canonicalRegionId,
  COUNTRY_CONFIGS,
  getRegionalBillAssentTitleForState,
  type CountryId,
} from "@/lib/constants/countries";
import type {
  State,
  StateBill,
  StateMetrics,
  FederalBudget,
  GovernorExecutiveOrder,
  GovernorAddress,
  GovernorEndorsement,
  GovernorQueuedBill,
  NPP,
  ElectedOfficial,
  GameState,
  LegislationType,
  Election,
  ElectionCandidate,
  Character,
  PoliticalParty,
} from "@/lib/db/types";
import { resolveGameYear } from "@/lib/era/era";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
import { isUKDevolutionRegion, proIndyHighDesireBonus } from "@/lib/constants/devolution";
import { referendumRequestEligibility } from "@/lib/constants/referendum";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import type { ReferendumPanelData } from "./tabs/devolution/ReferendumPanel";
import {
  BASE_APPROVAL,
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  loadElectorateGroups,
  weightingFor,
} from "@/lib/utils/governmentApproval";
import { loadPoliticalApprovalBases } from "@/lib/politicalLegislation/politicalApprovalProvider";
import { computeIndependenceDesireDriftSnapshot } from "@/lib/governorOffice/devolution/independenceDesireDrift";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { STATE_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { ObjectId } from "mongodb";
import {
  getEndorseableElectionTypes,
  getSubNationalLegislatureKey,
} from "@/lib/constants/countries";
import { getOfficeState } from "@/lib/governorOffice/queries";
import { resolveOfficeAccess } from "@/lib/governorOffice/access";
import type { ScopedVoteOfficial } from "@/lib/congress/billVoting";
import { resolveStateBillHeadlineTallies } from "@/lib/legislature/stateBillVoteScope";
import { GovernorOfficeClient } from "./GovernorOfficeClient";
import { ADDRESS_COOLDOWN_TURNS } from "@/lib/constants/governorOffice";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import { buildPartyIdResolver } from "@/lib/parties/partyMatch";

interface Props {
  params: Promise<{ code: string; id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, id: rawRegionParam } = await params;
  const id = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return {};
  const db = await getDb();
  const state = await db
    .collection<State>("states")
    .findOne({ _id: id.toUpperCase(), countryId: countryId });
  if (!state) return {};
  return {
    title: `${getRegionalBillAssentTitleForState(countryId, state._id)}'s Office · ${state.name} · A House Divided`,
  };
}

export default async function GovernorOfficePage({ params }: Props) {
  const { code, id: rawRegionParam } = await params;
  const id = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();
  const stateId = id.toUpperCase();

  const auth = await getAuthUserWithCharacter();
  if (!auth?.character) notFound();

  const db = await getDb();
  const state = await db
    .collection<State>("states")
    .findOne({ _id: stateId, countryId: countryId });
  if (!state) notFound();

  // Resolve office access. The human holder always qualifies; for an NPP-held
  // office the holding party's State Chair / Vice-Chair (or, only when the state
  // party has neither, the National Chair / Vice-Chair) may manage the
  // institutional tabs (Orders / Legislation / Devolution). Admins may view any
  // office. `access.holder` is the real seat-holder regardless of viewer.
  const isAdmin = auth.isAdmin === true;
  const access = await resolveOfficeAccess(db, countryId, stateId, auth.character._id);
  const officeHolder = access.holder;
  // 403-equivalent: surface as notFound so the page silently doesn't exist for
  // viewers who can neither manage it nor admin it.
  if (!access.canManage && !isAdmin) notFound();

  // Fetch the holder character (for avatar) and their party (for chip) in
  // parallel — neither lookup depends on the other.
  const hasHolderParty = officeHolder?.party != null && Number.isFinite(Number(officeHolder.party));
  const [holderChar, holderPartyDoc] = await Promise.all([
    officeHolder?.characterId
      ? db
          .collection<Character>("characters")
          .findOne({ _id: officeHolder.characterId }, { projection: { avatarUrl: 1 } })
      : Promise.resolve(null),
    hasHolderParty
      ? db
          .collection<PoliticalParty>("politicalParties")
          .findOne(
            { sequentialId: Number(officeHolder?.party), countryId },
            { projection: { name: 1, abbreviation: 1, color: 1 } }
          )
      : Promise.resolve(null),
  ]);
  const officeHolderAvatarUrl: string | null = holderChar?.avatarUrl ?? null;
  const officeHolderPartyName: string | null = holderPartyDoc?.name ?? null;
  const officeHolderPartyAbbreviation: string | null = holderPartyDoc?.abbreviation ?? null;
  const officeHolderPartyColor: string | null = holderPartyDoc?.color ?? null;

  const viewerIsHolder = access.viewerIsHolder;
  const viewerCanManage = access.canManage;
  // The office's party (holder's party) drives same-party legislation eligibility
  // so a party officer acting for an NPP-held office resolves the right NPPs.
  const officeParty = access.officeParty;

  // These reads are mutually independent — issue them as one parallel batch
  // instead of a serial chain of round-trips:
  //  - officeState
  //  - bills awaiting the governor's signature/veto
  //  - active executive orders, plus the most-recent terminated ones (history)
  //  - current game turn (relative expiry display)
  //  - legislation types eligible for executive-order targeting (not nationalOnly,
  //    countryScope match, not a tax-rate change)
  //  - most-recent governor address (cooldown countdown + summary)
  const legTypeCountryScope = code.toLowerCase() as LegislationType["countryScope"];
  const subNationalOffice = getSubNationalLegislatureKey(countryId);
  const voteScope = subNationalOffice ? { countryId, officeType: subNationalOffice } : null;
  const [
    officeState,
    awaitingAssentBills,
    activeOrders,
    orderHistory,
    gameStateDoc,
    legislationTypes,
    recentAddresses,
    chamberOfficials,
  ] = await Promise.all([
    getOfficeState(db, countryId, stateId),
    db
      .collection<StateBill>("stateBills")
      .find(
        { stateId, status: "passed" },
        {
          projection: {
            title: 1,
            summary: 1,
            sponsorId: 1,
            sponsorName: 1,
            sponsorParty: 1,
            votesFor: 1,
            votesAgainst: 1,
            votesAbstain: 1,
            votes: 1,
            voteSnapshot: 1,
            passedAt: 1,
          },
        }
      )
      .sort({ passedAt: 1 })
      .toArray(),
    db
      .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
      .find({ countryId, stateId, status: "active" })
      .sort({ issuedAtTurn: -1 })
      .toArray(),
    db
      .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
      .find({
        countryId,
        stateId,
        status: { $in: ["expired", "rescinded", "superseded"] },
      })
      .sort({ issuedAtTurn: -1 })
      .limit(10)
      .toArray(),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
    db
      .collection<LegislationType>("legislationTypes")
      .find({
        nationalOnly: { $ne: true },
        taxRateChange: { $exists: false },
        $or: [{ countryScope: legTypeCountryScope }, { countryScope: { $exists: false } }],
      })
      .project<{ _id: string; name: string; policyOptions?: { id: string; name: string }[] }>({
        _id: 1,
        name: 1,
        "policyOptions.id": 1,
        "policyOptions.name": 1,
      })
      .toArray(),
    db
      .collection<GovernorAddress>("governorAddresses")
      .find({ countryId, stateId })
      .sort({ deliveredAtTurn: -1 })
      .limit(1)
      .toArray(),
    db
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
      .toArray(),
  ]);
  const currentTurn = gameStateDoc?.currentTurn ?? 0;
  // Index legislation types by id so the order/history projections below are O(1)
  // lookups instead of a linear scan per row.
  const legislationTypeById = new Map(legislationTypes.map((t) => [t._id, t]));
  const mostRecentAddress = recentAddresses[0] ?? null;
  const availableAtTurn = mostRecentAddress
    ? mostRecentAddress.deliveredAtTurn + ADDRESS_COOLDOWN_TURNS
    : currentTurn;

  // Endorsements + available races within the state — sub-national + any
  // elected federal chambers. The state filter on `elections.state` does the
  // location scoping for federal races (e.g. AZ House seats have state="AZ").
  // Presidential is a special case: the row has `state: "US"` (or the country
  // code), so we fetch it separately and merge — a governor endorses the
  // national race because primary delegates / general electoral votes from
  // their state are at stake.
  const allowedRaceTypes = getEndorseableElectionTypes(countryId);
  const [scopedElections, presidentialElection] = await Promise.all([
    db
      .collection<Election>("elections")
      .find({
        state: stateId,
        countryId,
        status: "active",
        electionType: { $in: allowedRaceTypes },
      })
      .toArray(),
    db
      .collection<Election>("elections")
      .findOne({ electionType: "president", countryId, status: "active" }),
  ]);
  const stateElections: Election[] = presidentialElection
    ? [...scopedElections, presidentialElection]
    : scopedElections;
  const electionIds = stateElections.map((e) => e._id);
  const stateCandidates = electionIds.length
    ? await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: { $in: electionIds }, status: "active" })
        .toArray()
    : [];
  const activeEndorsements = await db
    .collection<GovernorEndorsement>("governorEndorsements")
    .find({
      countryId,
      stateId,
      endorsedByCharacterId: auth.character._id,
      isActive: true,
    })
    .toArray();
  const myEndorsedCandidateIds = new Set(activeEndorsements.map((e) => e.candidateId.toString()));
  const myParty = auth.character.party;

  const resolvePartyId = await buildPartyIdResolver(db, countryId);
  const myCanonicalParty = resolvePartyId(myParty);

  const playerCharacterIds = [
    ...new Set(stateCandidates.filter((c) => !c.isNPP && c.characterId).map((c) => c.characterId!)),
  ];
  const playerCharacters = playerCharacterIds.length
    ? await db
        .collection<Character>("characters")
        .find({ _id: { $in: playerCharacterIds } })
        .project<{ _id: ObjectId; party?: string }>({ _id: 1, party: 1 })
        .toArray()
    : [];
  const currentPartyByCharacterId = new Map(
    playerCharacters.map((c) => [c._id.toString(), c.party ?? null])
  );

  const candidatePartyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .project<{ sequentialId: number; name: string; color: string; logoUrl?: string }>({
      sequentialId: 1,
      name: 1,
      color: 1,
      logoUrl: 1,
    })
    .toArray();
  const partyBySeq = new Map(candidatePartyDocs.map((p) => [String(p.sequentialId), p]));

  // Use game-clock effective-now so phase labels match turn-based resolution
  // even when real time has drifted ahead of the last successful turn.
  const officePageGameTime = await getGameTime();

  // Sort by display-priority order from `getEndorseableElectionTypes`:
  // executive (President) → upper chamber → lower chamber → sub-national.
  // Tie-break by senateClass for the staggered US Senate so Class 1 renders
  // before Class 3 within the same chamber.
  const priorityIndex = new Map(allowedRaceTypes.map((t, i) => [t, i] as const));
  const sortedElections = [...stateElections].sort((a, b) => {
    const aPriority = priorityIndex.get(a.electionType as string) ?? 99;
    const bPriority = priorityIndex.get(b.electionType as string) ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return (a.senateClass ?? 0) - (b.senateClass ?? 0);
  });

  const availableRaces = sortedElections.map((e) => {
    const baseLabel = formatElectionTypeLabel(e.electionType as string, countryId);
    const suffix = [
      e.senateClass ? `Class ${e.senateClass}` : null,
      e.chamberClass ? `Chamber Class ${e.chamberClass}` : null,
      e.totalSeats && e.totalSeats > 1 ? `${e.totalSeats} seats` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const phase: "primary" | "general" = isPrimaryEnded(
      e,
      officePageGameTime.currentTurn,
      officePageGameTime
    )
      ? "general"
      : "primary";
    return {
      electionId: e._id.toString(),
      title: suffix ? `${baseLabel} · ${suffix}` : baseLabel,
      phase,
      candidates: stateCandidates
        .filter((c) => c.electionId.toString() === e._id.toString())
        .map((c) => {
          const effectiveParty =
            !c.isNPP && c.characterId
              ? (currentPartyByCharacterId.get(c.characterId.toString()) ?? c.party)
              : c.party;
          const canonicalParty = resolvePartyId(effectiveParty);
          const party = canonicalParty ? partyBySeq.get(canonicalParty) : undefined;
          return {
            id: c._id.toString(),
            name: c.characterName,
            party: effectiveParty,
            partyName: party?.name ?? null,
            partyColor: party?.color ?? null,
            partyLogoUrl: party?.logoUrl ?? null,
            isPartyMatch:
              myCanonicalParty != null &&
              canonicalParty != null &&
              myCanonicalParty === canonicalParty,
            alreadyEndorsedByMe: myEndorsedCandidateIds.has(c._id.toString()),
          };
        }),
    };
  });
  const electionTitleById = new Map(availableRaces.map((r) => [r.electionId, r.title]));

  // Legislation queue: pending entry + eligible NPPs (same-party state-legislators).
  const pendingQueue = await db
    .collection<GovernorQueuedBill>("governorLegislationQueue")
    .findOne({ countryId, stateId, status: "pending" });

  // In-flight governor bill — once the queue fires, the StateBill carries
  // `proposedByGovernor` and we keep the office's "your bill" slot occupied
  // through the full lifecycle (active → passed → veto_override) until it
  // hits a terminal status (enacted / failed / override_failed / signed).
  // Tied to the office (per-state), not the specific governor character, so a
  // successor sees in-flight bills inherited from their predecessor.
  const inFlightGovernorBill = await db.collection<StateBill>("stateBills").findOne(
    {
      stateId,
      countryId,
      proposedByGovernor: { $exists: true },
      status: { $nin: STATE_TERMINAL_STATUSES },
    },
    { sort: { proposedAt: -1 } }
  );

  // Devolution tab data — only for UK SCO/WAL/NIR seats. Computes the per-turn
  // driver preview from the same shared helper the engine uses, so the UI
  // breakdown stays in lockstep with the actual drift math.
  let devolutionProps: {
    currentValue: number;
    currentTrend: number;
    currentPolicy: DevolutionPolicy;
    policyChangedAtTurn: number | null;
    proIndyElectionBonus: number;
    driverPreview: {
      drivers: {
        policy: number;
        regionalApproval: number;
        nationalApproval: number;
        inflation: number;
        meanReversion: number;
      };
      delta: number;
      next: number;
      inputs: {
        regionalApproval: number;
        nationalApproval: number;
        inflationPercent: number;
      };
    };
    referendum: ReferendumPanelData;
  } | null = null;
  if (countryId === COUNTRY_CONFIGS.UK.id && isUKDevolutionRegion(stateId)) {
    const ukStateIds = await db.collection<State>("states").distinct("_id", { countryId: "UK" });
    // SP5: UK regions live on macroMetrics (independenceDesire hoisted); merge
    // back to the legacy doc shape so downstream reads are unchanged.
    const ukMacroDocs = ukStateIds.length
      ? await db
          .collection<MacroMetricsDoc>("macroMetrics")
          .find({ _id: { $in: ukStateIds } })
          .toArray()
      : [];
    const ukMetrics = ukMacroDocs
      .map((doc) => mergeRegionMetrics(doc))
      .filter((m): m is StateMetrics => m !== null);
    const thisMetric = ukMetrics.find((m) => m._id === stateId);
    if (thisMetric) {
      const ukApprovalDoc = await db
        .collection<GovernmentApproval>("governmentApprovals")
        .findOne({ _id: "UK" });
      const nationalApproval = ukApprovalDoc?.approvalRating ?? 50;
      const ukBudget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ _id: getNationalBudgetId("UK") });
      const inflationPercent = ukBudget?.economicFactors?.inflationRate ?? 2;
      const nationalAverages = computeNationalAveragesFromMetrics(ukMetrics);
      // Electorate-weighted, era-correct approval — the same value the drift
      // ENGINE applies each turn (independenceDesireDrift). Previously this
      // preview omitted both weighting and preset, so the displayed driver
      // disagreed with the region hero and with the actual drift input.
      const groupsByState = await loadElectorateGroups(db, { countryId: "UK", _id: stateId });
      const preset = gameStateDoc?.preset ?? null;
      // Live year for era-aware scoring; null while the flag is off (legacy path).
      const year = gameStateDoc?.eraSystemEnabled ? resolveGameYear(gameStateDoc) : null;
      // SP4: the UK is a playable-pipeline country — the drift driver preview
      // reads the hybrid political base, matching the converted drift engine.
      const ukBases = await loadPoliticalApprovalBases(db, "UK");
      const regionalApproval = calculateStateApproval(
        thisMetric,
        nationalAverages,
        [],
        weightingFor(groupsByState, "UK", stateId),
        preset,
        year,
        ukBases?.byRegion.get(stateId) ?? BASE_APPROVAL
      );
      const previous = thisMetric.governance?.independenceDesire?.value ?? 50;
      const trend = thisMetric.governance?.independenceDesire?.trend ?? 0;
      const policy: DevolutionPolicy =
        (officeState?.devolutionPolicy as DevolutionPolicy | undefined) ?? "pro";
      const snapshot = computeIndependenceDesireDriftSnapshot({
        previous,
        policy,
        regionalApproval,
        nationalApproval,
        inflationPercent,
      });
      // Current/most-recent referendum for this region + request eligibility.
      const activeRef = await getReferendumCollection(db).findOne({
        regionId: stateId,
        status: {
          $in: ["requested", "granted", "campaigning", "polling", "actuating"],
        },
      });
      const lastTerminal = await getReferendumCollection(db)
        .find({
          regionId: stateId,
          status: { $in: ["declined", "settled", "completed", "cancelled"] },
        })
        .sort({ updatedAt: -1 })
        .limit(1)
        .toArray();
      const displayRef = activeRef ?? lastTerminal[0] ?? null;
      const eligibility = referendumRequestEligibility({
        desire: previous,
        hasActiveReferendum: activeRef != null,
        cooldownReadyAtTurn: lastTerminal[0]?.cooldownReadyAtTurn ?? null,
        currentTurn,
      });
      const referendum: ReferendumPanelData = {
        referendum: displayRef
          ? {
              id: String(displayRef._id),
              status: displayRef.status,
              kind: displayRef.kind,
              yesShare: displayRef.yesShare,
              campaignCloseTurn: displayRef.campaignCloseTurn,
              cooldownReadyAtTurn: displayRef.cooldownReadyAtTurn,
            }
          : null,
        eligible: eligibility.eligible,
        eligibilityReason: eligibility.reason,
      };

      devolutionProps = {
        currentValue: previous,
        currentTrend: trend,
        currentPolicy: policy,
        policyChangedAtTurn: officeState?.devolutionPolicyChangedAtTurn ?? null,
        proIndyElectionBonus: proIndyHighDesireBonus(previous),
        driverPreview: {
          drivers: snapshot.drivers,
          delta: snapshot.delta,
          next: snapshot.next,
          inputs: { regionalApproval, nationalApproval, inflationPercent },
        },
        referendum,
      };
    }
  }

  let eligibleNpps: Array<{ _id: string; name: string }> = [];
  if (officeParty) {
    const stateSenators = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        officeType: getSubNationalLegislatureKey(countryId),
        state: stateId,
        isNPP: true,
      })
      .toArray();
    const nppIds = stateSenators.map((s) => s.nppId).filter((x): x is ObjectId => !!x);
    const npps = nppIds.length
      ? await db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds }, party: officeParty, retiredAt: null })
          .toArray()
      : [];
    const blocking = npps.length
      ? await db
          .collection<StateBill>("stateBills")
          .find({
            sponsorNppId: { $in: npps.map((n) => n._id) },
            status: { $nin: STATE_TERMINAL_STATUSES },
          })
          .project<{ sponsorNppId: ObjectId }>({ sponsorNppId: 1 })
          .toArray()
      : [];
    const blockedSet = new Set(blocking.map((b) => b.sponsorNppId.toString()));
    eligibleNpps = npps
      .filter((n) => !blockedSet.has(n._id.toString()))
      .map((n) => ({ _id: n._id.toString(), name: n.name }));
  }

  const inFlightTally = inFlightGovernorBill
    ? resolveStateBillHeadlineTallies(inFlightGovernorBill, chamberOfficials, voteScope)
    : null;

  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <GovernorOfficeClient
        countryId={countryId}
        stateId={stateId}
        stateName={state.name}
        stateBannerImage={state.bannerImage ?? null}
        regionalTitle={getRegionalBillAssentTitleForState(countryId, stateId)}
        officeHolderName={officeHolder?.characterName ?? null}
        officeHolderAvatarUrl={officeHolderAvatarUrl}
        officeHolderPartyName={officeHolderPartyName}
        officeHolderPartyAbbreviation={officeHolderPartyAbbreviation}
        officeHolderPartyColor={officeHolderPartyColor}
        viewerIsAdmin={isAdmin}
        viewerIsHolder={viewerIsHolder}
        viewerCanManage={viewerCanManage}
        gubernatorialActions={officeState?.gubernatorialActions ?? 0}
        lastActionGrantedTurn={officeState?.lastActionGrantedTurn ?? 0}
        awaitingAssentBills={awaitingAssentBills.map((b) => {
          const tally = resolveStateBillHeadlineTallies(b, chamberOfficials, voteScope);
          return {
            _id: b._id.toString(),
            title: b.title,
            summary: b.summary,
            sponsorId: b.sponsorId?.toString() ?? null,
            sponsorName: b.sponsorName,
            sponsorParty: b.sponsorParty ?? null,
            votesFor: tally.votesFor,
            votesAgainst: tally.votesAgainst,
          };
        })}
        activeOrders={activeOrders.map((o) => {
          const type = legislationTypeById.get(o.legislationTypeId);
          return {
            _id: o._id!.toString(),
            legislationTypeId: o.legislationTypeId,
            legislationTypeName: type?.name ?? o.legislationTypeId,
            effectDirection: o.effectDirection,
            policyOptionIndexBefore: o.policyOptionIndexBefore,
            policyOptionIndexAfter: o.policyOptionIndexAfter,
            policyOptionNameBefore: type?.policyOptions?.[o.policyOptionIndexBefore]?.name ?? null,
            policyOptionNameAfter: type?.policyOptions?.[o.policyOptionIndexAfter]?.name ?? null,
            expiresAtTurn: o.expiresAtTurn,
            issuedByName: o.issuedByName,
          };
        })}
        orderHistory={orderHistory.map((o) => {
          const type = legislationTypeById.get(o.legislationTypeId);
          return {
            _id: o._id!.toString(),
            legislationTypeId: o.legislationTypeId,
            legislationTypeName: type?.name ?? o.legislationTypeId,
            effectDirection: o.effectDirection,
            policyOptionNameBefore: type?.policyOptions?.[o.policyOptionIndexBefore]?.name ?? null,
            policyOptionNameAfter: type?.policyOptions?.[o.policyOptionIndexAfter]?.name ?? null,
            status: o.status as "expired" | "rescinded" | "superseded",
            issuedAtTurn: o.issuedAtTurn,
            expiresAtTurn: o.expiresAtTurn,
            rescindedAtTurn: o.rescindedAtTurn ?? null,
            issuedByName: o.issuedByName,
          };
        })}
        legislationTypes={legislationTypes.map((t) => ({ id: t._id, name: t.name }))}
        currentTurn={currentTurn}
        mostRecentAddress={
          mostRecentAddress
            ? {
                deliveredAtTurn: mostRecentAddress.deliveredAtTurn,
                deliveredByName: mostRecentAddress.deliveredByName,
                title: mostRecentAddress.title ?? null,
                body: mostRecentAddress.body ?? null,
                emphasizedCategories:
                  mostRecentAddress.emphasizedCategories ??
                  mostRecentAddress.emphasizedLegislationTypeIds ??
                  [],
                targetDemographicGroupId: mostRecentAddress.targetDemographicGroupId ?? null,
                approvalEffect: {
                  amount: mostRecentAddress.approvalEffect.amount,
                  expiresAtTurn: mostRecentAddress.approvalEffect.expiresAtTurn,
                },
                agendaEffect: mostRecentAddress.agendaEffect
                  ? { expiresAtTurn: mostRecentAddress.agendaEffect.expiresAtTurn }
                  : null,
                demographicEffect: mostRecentAddress.demographicEffect
                  ? {
                      turnoutDelta: mostRecentAddress.demographicEffect.turnoutDelta ?? 0,
                      expiresAtTurn: mostRecentAddress.demographicEffect.expiresAtTurn,
                    }
                  : null,
              }
            : null
        }
        addressAvailableAtTurn={availableAtTurn}
        activeEndorsements={activeEndorsements.map((e) => {
          const p = e.candidatePartyId ? partyBySeq.get(e.candidatePartyId) : undefined;
          return {
            _id: e._id!.toString(),
            electionId: e.electionId.toString(),
            candidateId: e.candidateId.toString(),
            candidateName: e.candidateName,
            electionTitle: electionTitleById.get(e.electionId.toString()) ?? "Election",
            partyId: e.candidatePartyId,
            partyName: p?.name ?? null,
            partyColor: p?.color ?? null,
            partyLogoUrl: p?.logoUrl ?? null,
          };
        })}
        availableRaces={availableRaces}
        legislationActivity={
          inFlightGovernorBill && inFlightTally
            ? {
                kind: "in_flight",
                billId: inFlightGovernorBill._id.toString(),
                title: inFlightGovernorBill.title,
                status: inFlightGovernorBill.status as "active" | "passed" | "veto_override",
                votesFor: inFlightTally.votesFor,
                votesAgainst: inFlightTally.votesAgainst,
                votingEndsAt: inFlightGovernorBill.votingEndsAt?.toISOString() ?? null,
                overrideVotingEndsAt:
                  inFlightGovernorBill.overrideVotingEndsAt?.toISOString() ?? null,
                overrideVotesFor: inFlightTally.overrideVotesFor,
                overrideVotesAgainst: inFlightTally.overrideVotesAgainst,
                sponsorName: inFlightGovernorBill.sponsorName,
                targetNppName: inFlightGovernorBill.sponsorName,
              }
            : pendingQueue
              ? {
                  kind: "pending",
                  queueId: pendingQueue._id!.toString(),
                  title: pendingQueue.title,
                  targetNppName: pendingQueue.targetNppName,
                  queuedAtTurn: pendingQueue.queuedAtTurn,
                }
              : null
        }
        eligibleNpps={eligibleNpps}
        devolution={devolutionProps}
      />
    </Suspense>
  );
}
